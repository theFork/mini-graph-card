import { LitElement, html, svg } from 'lit-element';
import localForage from 'localforage/src/localforage';
import Graph from './graph';
import style from './style';
import handleClick from './handleClick';
import buildConfig from './buildConfig';
import './initialize';

import {
  ICONS,
  UPDATE_PROPS,
  X, Y, V,
  ONE_HOUR,
} from './const';
import {
  getMin, getAvg, getMax,
  getTime, getMilli,
  interpolateColor,
  compress, decompress,
  getFirstDefinedItem,
  compareArray,
  log,
} from './utils';

class MiniGraphCard extends LitElement {
  constructor() {
    super();
    this.id = Math.random()
      .toString(36)
      .substr(2, 9);
    this.config = {};
    this.bound = [0, 0];
    this.boundSecondary = [0, 0];
    this.length = [];
    this.entity = [];
    this.line = [];
    this.bar = [];
    this.abs = [];
    this.fill = [];
    this.points = [];
    this.gradient = [];
    this.tooltip = {};
    this.updateQueue = [];
    this.updating = false;
    this.stateChanged = false;
    this.initial = true;
  }

  static get styles() {
    return style;
  }

  set hass(hass) {
    this._hass = hass;
    let updated = false;
    const queue = [];
    this.config.entities.forEach((entity, index) => {
      this.config.entities[index].index = index; // Required for filtered views
      const entityState = hass.states[entity.entity];
      if (entityState && this.entity[index] !== entityState) {
        this.entity[index] = entityState;
        queue.push(entityState.entity_id);
        updated = true;
      }
    });
    if (updated) {
      this.stateChanged = true;
      this.entity = [...this.entity];
      if (!this.config.update_interval && !this.updating) {
        setTimeout(() => {
          this.updateQueue = [...queue, ...this.updateQueue];
          this.updateData();
        }, this.initial ? 0 : 1000);
      } else {
        this.updateQueue = [...queue, ...this.updateQueue];
      }
    }
  }

  static get properties() {
    return {
      id: String,
      _hass: {},
      config: {},
      entity: [],
      Graph: [],
      line: [],
      shadow: [],
      length: Number,
      bound: [],
      boundSecondary: [],
      abs: [],
      tooltip: {},
      updateQueue: [],
      color: String,
    };
  }

  setConfig(config) {
    const entitiesChanged = !compareArray(this.config.entities || [], config.entities);

    this.config = buildConfig(config, this.config);

    if (!this.Graph || entitiesChanged) {
      if (this._hass) this.hass = this._hass;
      this.Graph = this.config.entities.map(
        entity => new Graph(
          500,
          this.config.height,
          [this.config.show.fill ? 0 : this.config.line_width, this.config.line_width],
          this.config.hours_to_show,
          this.config.points_per_hour,
          entity.aggregate_func || this.config.aggregate_func,
          this.config.group_by,
          getFirstDefinedItem(
            entity.smoothing,
            this.config.smoothing,
            !entity.entity.startsWith('binary_sensor.'), // turn off for binary sensor by default
          ),
        ),
      );
    }
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.config.update_interval) {
      this.updateOnInterval();
      this.interval = setInterval(
        () => this.updateOnInterval(),
        this.config.update_interval * 1000,
      );
    }
  }

  disconnectedCallback() {
    if (this.interval) {
      clearInterval(this.interval);
    }
    super.disconnectedCallback();
  }

  shouldUpdate(changedProps) {
    if (!this.entity[0]) return false;
    if (UPDATE_PROPS.some(prop => changedProps.has(prop))) {
      this.color = this.intColor(
        this.tooltip.value !== undefined ? this.tooltip.value : this.entity[0].state,
        this.tooltip.entity || 0,
      );
      return true;
    }
  }

  firstUpdated() {
    this.initial = false;
  }

  updated(changedProperties) {
    if (this.config.animate && changedProperties.has('line')) {
      if (this.length.length < this.entity.length) {
        this.shadowRoot.querySelectorAll('svg path.line').forEach((ele) => {
          this.length[ele.id] = ele.getTotalLength();
        });
        this.length = [...this.length];
      } else {
        this.length = Array(this.entity.length).fill('none');
      }
    }
  }

  render({ config } = this) {
    return html`
      <ha-card
        class="flex"
        ?group=${config.group}
        ?fill=${config.show.graph && config.show.fill}
        ?points=${config.show.points === 'hover'}
        ?labels=${config.show.labels === 'hover'}
        ?labels-secondary=${config.show.labels_secondary === 'hover'}
        ?gradient=${config.color_thresholds.length > 0}
        ?hover=${config.tap_action.action !== 'none'}
        style="font-size: ${config.font_size}px;"
        @click=${e => this.handlePopup(e, config.tap_action.entity || this.entity[0])}
      >
        ${this.renderHeader()} ${this.renderStates()} ${this.renderGraph()} ${this.renderInfo()}
      </ha-card>
    `;
  }

  renderHeader() {
    const {
      show, align_icon, align_header, font_size_header,
    } = this.config;
    return show.name || (show.icon && align_icon !== 'state')
      ? html`
          <div class="header flex" loc=${align_header} style="font-size: ${font_size_header}px;">
            ${this.renderName()} ${align_icon !== 'state' ? this.renderIcon() : ''}
          </div>
        `
      : '';
  }

  renderIcon() {
    const { icon, icon_adaptive_color } = this.config.show;
    return icon ? html`
      <div class="icon" loc=${this.config.align_icon}
        style=${icon_adaptive_color ? `color: ${this.color};` : ''}>
        <ha-icon .icon=${this.computeIcon(this.entity[0])}></ha-icon>
      </div>
    ` : '';
  }

  renderName() {
    if (!this.config.show.name) return;
    const name = this.tooltip.entity !== undefined
      ? this.computeName(this.tooltip.entity)
      : this.config.name || this.computeName(0);
    const color = this.config.show.name_adaptive_color ? `opacity: 1; color: ${this.color};` : '';

    return html`
      <div class="name flex">
        <span class="ellipsis" style=${color}>${name}</span>
      </div>
    `;
  }

  renderStates() {
    const { entity, value } = this.tooltip;
    const state = value !== undefined ? value : this.entity[0].state;
    const color = this.config.entities[0].state_adaptive_color ? `color: ${this.color};` : '';
    if (this.config.show.state)
      return html`
        <div class="states flex" loc=${this.config.align_state}>
          <div class="state">
            <span class="state__value ellipsis" style=${color}>
              ${this.computeState(state, this.getAxis(entity || 0))}
            </span>
            <span class="state__uom ellipsis" style=${color}>
              ${this.computeUom(entity || 0)}
            </span>
            ${this.renderStateTime()}
          </div>
          <div class="states--secondary">${this.config.entities.map((ent, i) => this.renderState(ent, i))}</div>
          ${this.config.align_icon === 'state' ? this.renderIcon() : ''}
        </div>
      `;
  }

  renderState(entity, id) {
    if (entity.show_state && id !== 0) {
      const { state } = this.entity[id];
      return html`
        <div
          class="state state--small"
          @click=${e => this.handlePopup(e, this.entity[id])}
          style=${entity.state_adaptive_color ? `color: ${this.computeColor(state, id)};` : ''}>
          ${entity.show_indicator ? this.renderIndicator(state, id) : ''}
          <span class="state__value ellipsis">
            ${this.computeState(state, this.getAxis(id))}
          </span>
          <span class="state__uom ellipsis">
            ${this.computeUom(id)}
          </span>
        </div>
      `;
    }
  }

  renderStateTime() {
    if (this.tooltip.value === undefined) return;
    return html`
      <div class="state__time">
        ${this.tooltip.label ? html`
          <span>${this.tooltip.label}</span>
        ` : html`
          <span>${this.tooltip.time[0]}</span> -
          <span>${this.tooltip.time[1]}</span>
        `}
      </div>
    `;
  }

  renderGraph() {
    return this.config.show.graph ? html`
      <div class="graph">
        <div class="graph__container">
          ${this.renderLabels()}
          ${this.renderLabelsSecondary()}
          <div class="graph__container__svg">
            ${this.renderSvg()}
          </div>
        </div>
        ${this.renderLegend()}
      </div>` : '';
  }

  renderLegend() {
    if (this.visibleLegends.length <= 1 || !this.config.show.legend) return;
    return html`
      <div class="graph__legend">
        ${this.visibleLegends.map(entity => html`
          <div class="graph__legend__item"
            @click=${e => this.handlePopup(e, this.entity[entity.index])}
            @mouseenter=${() => this.setTooltip(entity.index, -1, this.entity[entity.index].state, 'Current')}
            @mouseleave=${() => (this.tooltip = {})}>
            ${this.renderIndicator(this.entity[entity.index].state, entity.index)}
            <span class="ellipsis">${this.computeName(entity.index)}</span>
          </div>
        `)}
      </div>
    `;
  }

  renderIndicator(state, index) {
    return svg`
      <svg width='10' height='10'>
        <rect width='10' height='10' fill=${this.intColor(state, index)} />
      </svg>
    `;
  }

  renderSvgFill(fill, i) {
    if (!fill) return;
    const fade = this.config.show.fill === 'fade';
    const init = this.length[i] || this.config.entities[i].show_line === false;
    return svg`
      <defs>
        <linearGradient id=${`fill-grad-${this.id}-${i}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop stop-color='white' offset='0%' stop-opacity='1'/>
          <stop stop-color='white' offset='100%' stop-opacity='.15'/>
        </linearGradient>
        <mask id=${`fill-grad-mask-${this.id}-${i}`}>
          <rect width="100%" height="100%" fill=${`url(#fill-grad-${this.id}-${i})`} />
        </mask>
      </defs>
      <mask id=${`fill-${this.id}-${i}`}>
        <path class='fill'
          type=${this.config.show.fill}
          .id=${i} anim=${this.config.animate} ?init=${init}
          style="animation-delay: ${this.config.animate ? `${i * 0.5}s` : '0s'}"
          fill='white'
          mask=${fade ? `url(#fill-grad-mask-${this.id}-${i})` : ''}
          d=${this.fill[i]}
        />
      </mask>`;
  }

  renderSvgLine(line, i) {
    if (!line) return;

    const path = svg`
      <path
        class='line'
        .id=${i}
        anim=${this.config.animate} ?init=${this.length[i]}
        style="animation-delay: ${this.config.animate ? `${i * 0.5}s` : '0s'}"
        fill='none'
        stroke-dasharray=${this.length[i] || 'none'} stroke-dashoffset=${this.length[i] || 'none'}
        stroke=${'white'}
        stroke-width=${this.config.line_width}
        d=${this.line[i]}
      />`;

    return svg`
      <mask id=${`line-${this.id}-${i}`}>
        ${path}
      </mask>
    `;
  }

  renderSvgPoint(point, i) {
    const color = this.gradient[i] ? this.computeColor(point[V], i) : 'inherit';
    return svg`
      <circle
        class='line--point'
        ?inactive=${this.tooltip.index !== point[3]}
        style=${`--mcg-hover: ${color};`}
        stroke=${color}
        fill=${color}
        cx=${point[X]} cy=${point[Y]} r=${this.config.line_width}
        @mouseover=${() => this.setTooltip(i, point[3], point[V])}
        @mouseout=${() => (this.tooltip = {})}
      />
    `;
  }

  renderSvgPoints(points, i) {
    if (!points) return;
    const color = this.computeColor(this.entity[i].state, i);
    return svg`
      <g class='line--points'
        ?tooltip=${this.tooltip.entity === i}
        ?inactive=${this.tooltip.entity !== undefined && this.tooltip.entity !== i}
        ?init=${this.length[i]}
        anim=${this.config.animate && this.config.show.points !== 'hover'}
        style="animation-delay: ${this.config.animate ? `${i * 0.5 + 0.5}s` : '0s'}"
        fill=${color}
        stroke=${color}
        stroke-width=${this.config.line_width / 2}>
        ${points.map(point => this.renderSvgPoint(point, i))}
      </g>`;
  }

  renderSvgGradient(gradients) {
    if (!gradients) return;
    const items = gradients.map((gradient, i) => {
      if (!gradient) return;
      return svg`
        <linearGradient id=${`grad-${this.id}-${i}`} gradientTransform="rotate(90)">
          ${gradient.map(stop => svg`
            <stop stop-color=${stop.color} offset=${`${stop.offset}%`} />
          `)}
        </linearGradient>`;
    });
    return svg`${items}`;
  }

  renderSvgLineRect(line, i) {
    if (!line) return;
    const fill = this.gradient[i]
      ? `url(#grad-${this.id}-${i})`
      : this.computeColor(this.entity[i].state, i);
    return svg`
      <rect class='line--rect'
        ?inactive=${this.tooltip.entity !== undefined && this.tooltip.entity !== i}
        id=${`rect-${this.id}-${i}`}
        fill=${fill} height="100%" width="100%"
        mask=${`url(#line-${this.id}-${i})`}
      />`;
  }

  renderSvgFillRect(fill, i) {
    if (!fill) return;
    const svgFill = this.gradient[i]
      ? `url(#grad-${this.id}-${i})`
      : this.intColor(this.entity[i].state, i);
    return svg`
      <rect class='fill--rect'
        ?inactive=${this.tooltip.entity !== undefined && this.tooltip.entity !== i}
        id=${`fill-rect-${this.id}-${i}`}
        fill=${svgFill} height="100%" width="100%"
        mask=${`url(#fill-${this.id}-${i})`}
      />`;
  }

  renderSvgBars(bars, index) {
    if (!bars) return;
    const items = bars.map((bar, i) => {
      const animation = this.config.animate
        ? svg`
          <animate attributeName='y' from=${this.config.height} to=${bar.y} dur='1s' fill='remove'
            calcMode='spline' keyTimes='0; 1' keySplines='0.215 0.61 0.355 1'>
          </animate>`
        : '';
      const color = this.computeColor(bar.value, index);
      return svg`
        <rect class='bar' x=${bar.x} y=${bar.y}
          height=${bar.height} width=${bar.width} fill=${color}
          @mouseover=${() => this.setTooltip(index, i, bar.value)}
          @mouseout=${() => (this.tooltip = {})}>
          ${animation}
        </rect>`;
    });
    return svg`<g class='bars' ?anim=${this.config.animate}>${items}</g>`;
  }

  renderSvg() {
    const { height } = this.config;
    return svg`
      <svg width='100%' height=${height !== 0 ? '100%' : 0} viewBox='0 0 500 ${height}'
        @click=${e => e.stopPropagation()}>
        <g>
          <defs>
            ${this.renderSvgGradient(this.gradient)}
          </defs>
          ${this.fill.map((fill, i) => this.renderSvgFill(fill, i))}
          ${this.fill.map((fill, i) => this.renderSvgFillRect(fill, i))}
          ${this.line.map((line, i) => this.renderSvgLine(line, i))}
          ${this.line.map((line, i) => this.renderSvgLineRect(line, i))}
          ${this.bar.map((bars, i) => this.renderSvgBars(bars, i))}
        </g>
        ${this.points.map((points, i) => this.renderSvgPoints(points, i))}
      </svg>`;
  }

  setTooltip(entity, index, value, label = null) {
    const {
      points_per_hour,
      hours_to_show,
      format,
    } = this.config;
    const offset = hours_to_show < 1 && points_per_hour < 1
      ? points_per_hour * hours_to_show
      : 1 / points_per_hour;

    const id = Math.abs(index + 1 - Math.ceil(hours_to_show * points_per_hour));

    const now = this.getEndDate();

    const oneMinInHours = 1 / 60;
    now.setMilliseconds(now.getMilliseconds() - getMilli(offset * id + oneMinInHours));
    const end = getTime(now, { hour12: !this.config.hour24 }, this._hass.language);
    now.setMilliseconds(now.getMilliseconds() - getMilli(offset - oneMinInHours));
    const start = getTime(now, format, this._hass.language);

    this.tooltip = {
      value,
      id,
      entity,
      time: [start, end],
      index,
      label,
    };
  }

  renderLabels() {
    if (!this.config.show.labels || this.primaryYaxisSeries.length === 0) return;
    return html`
      <div class="graph__labels --primary flex">
        <span class="label--max">${this.computeState(this.bound[1], 'primary')}</span>
        <span class="label--min">${this.computeState(this.bound[0], 'primary')}</span>
      </div>
    `;
  }

  renderLabelsSecondary() {
    if (!this.config.show.labels_secondary || this.secondaryYaxisSeries.length === 0) return;
    return html`
      <div class="graph__labels --secondary flex">
        <span class="label--max">${this.computeState(this.boundSecondary[1], 'secondary')}</span>
        <span class="label--min">${this.computeState(this.boundSecondary[0], 'secondary')}</span>
      </div>
    `;
  }

  renderInfo() {
    return html`
      <div class="info flex">
        ${this.abs.map(entry => html`
          <div class="info__item">
            <span class="info__item__type">${entry.type}</span>
            <span class="info__item__value">
              ${this.computeState(entry.state, this.getAxis(0))} ${this.computeUom(0)}
            </span>
            <span class="info__item__time">
              ${entry.type !== 'avg' ? getTime(new Date(entry.last_changed), this.config.format, this._hass.language) : ''}
            </span>
          </div>
        `)}
      </div>
    `;
  }

  handlePopup(e, entity) {
    e.stopPropagation();
    handleClick(this, this._hass, this.config, this.config.tap_action, entity.entity_id || entity);
  }

  computeColor(inState, i) {
    const { color_thresholds, line_color } = this.config;
    const state = Number(inState) || 0;
    const threshold = {
      color: line_color[i] || line_color[0],
      ...color_thresholds.slice(-1)[0],
      ...color_thresholds.find(ele => ele.value < state),
    };
    return this.config.entities[i].color || threshold.color;
  }

  get visibleEntities() {
    return this.config.entities.filter(entity => entity.show_graph !== false);
  }

  get primaryYaxisEntities() {
    return this.visibleEntities.filter(entity => entity.y_axis === undefined
      || entity.y_axis === 'primary');
  }

  get secondaryYaxisEntities() {
    return this.visibleEntities.filter(entity => entity.y_axis === 'secondary');
  }

  get visibleLegends() {
    return this.visibleEntities.filter(entity => entity.show_legend !== false);
  }

  get primaryYaxisSeries() {
    return this.primaryYaxisEntities.map(entity => this.Graph[entity.index]);
  }

  get secondaryYaxisSeries() {
    return this.secondaryYaxisEntities.map(entity => this.Graph[entity.index]);
  }

  isStateAxis(axis) {
    return this.config.state_map.map.length > 0 && this.config.state_map.axis === axis;
  }

  getAxis(entityId) {
    return this.config.entities[entityId].y_axis || 'primary';
  }

  intColor(inState, i) {
    const { color_thresholds, line_color } = this.config;
    const state = Number(inState) || 0;

    let intColor;
    if (color_thresholds.length > 0) {
      if (this.config.show.graph === 'bar') {
        const { color } = color_thresholds.find(ele => ele.value < state)
          || color_thresholds.slice(-1)[0];
        intColor = color;
      } else {
        const index = color_thresholds.findIndex(ele => ele.value < state);
        const c1 = color_thresholds[index];
        const c2 = color_thresholds[index - 1];
        if (c2) {
          const factor = (c2.value - inState) / (c2.value - c1.value);
          intColor = interpolateColor(c2.color, c1.color, factor);
        } else {
          intColor = index
            ? color_thresholds[color_thresholds.length - 1].color
            : color_thresholds[0].color;
        }
      }
    }

    return this.config.entities[i].color || intColor || line_color[i] || line_color[0];
  }

  computeName(index) {
    return this.config.entities[index].name || this.entity[index].attributes.friendly_name;
  }

  computeIcon(entity) {
    return (
      this.config.icon
      || entity.attributes.icon
      || ICONS[entity.attributes.device_class]
      || ICONS.temperature
    );
  }

  computeUom(index) {
    return (
      this.config.entities[index].unit
      || this.config.unit
      || this.entity[index].attributes.unit_of_measurement
      || ''
    );
  }

  computeState(inState, axis = 'primary') {
    if (this.isStateAxis(axis)) {
      const { map } = this.config.state_map;
      const stateMap = Number.isInteger(inState)
        ? map[inState]
        : map.find(state => state.value === inState);

      if (stateMap) return stateMap.label;
      log(`value [${inState}] not found in state_map`);
    }

    let state;
    if (typeof inState === 'string') {
      state = parseFloat(inState.replace(/,/g, '.'));
    } else {
      state = Number(inState);
    }
    const dec = this.config.decimals;
    if (dec === undefined || Number.isNaN(dec) || Number.isNaN(state))
      return Math.round(state * 100) / 100;

    const x = 10 ** dec;
    return (Math.round(state * x) / x).toFixed(dec);
  }

  updateOnInterval() {
    if (this.stateChanged && !this.updating) {
      this.stateChanged = false;
      this.updateData();
    }
  }

  async updateData({ config } = this) {
    this.updating = true;

    const end = this.getEndDate();
    const start = new Date(end);
    start.setMilliseconds(start.getMilliseconds() - getMilli(config.hours_to_show));

    try {
      const promise = this.entity.map((entity, i) => this.updateEntity(entity, i, start, end));
      await Promise.all(promise);
    } catch (err) {
      log(err);
    }


    if (config.show.graph) {
      this.entity.forEach((entity, i) => {
        if (entity) this.Graph[i].update();
      });
    }

    this.updateBounds();

    if (config.show.graph) {
      let graphPos = 0;
      this.entity.forEach((entity, i) => {
        if (!entity || this.Graph[i].coords.length === 0) return;
        const bound = config.entities[i].y_axis === 'secondary' ? this.boundSecondary : this.bound;
        [this.Graph[i].min, this.Graph[i].max] = [bound[0], bound[1]];
        if (config.show.graph === 'bar') {
          const numVisible = this.visibleEntities.length;
          this.bar[i] = this.Graph[i].getBars(graphPos, numVisible, config.bar_spacing);
          graphPos += 1;
        } else {
          const line = this.Graph[i].getPath();
          if (config.entities[i].show_line !== false) this.line[i] = line;
          if (config.show.fill
            && config.entities[i].show_fill !== false) this.fill[i] = this.Graph[i].getFill(line);
          if (config.show.points && (config.entities[i].show_points !== false)) {
            this.points[i] = this.Graph[i].getPoints();
          }
          if (config.color_thresholds.length > 0 && !config.entities[i].color)
            this.gradient[i] = this.Graph[i].computeGradient(config.color_thresholds);
        }
      });
      this.line = [...this.line];
    }
    this.updating = false;
    this.setNextUpdate();
  }

  updateBounds({ config } = this) {
    this.bound = this.isStateAxis('primary')
      ? [0, this.config.state_map.map.length - 1]
      : [
        config.lower_bound !== undefined
          ? config.lower_bound
          : Math.min(...this.primaryYaxisSeries.map(ele => ele.min)) || this.bound[0],
        config.upper_bound !== undefined
          ? config.upper_bound
          : Math.max(...this.primaryYaxisSeries.map(ele => ele.max)) || this.bound[1],
      ];

    this.boundSecondary = this.isStateAxis('secondary')
      ? [0, this.config.state_map.map.length - 1]
      : [
        config.lower_bound_secondary !== undefined
          ? config.lower_bound_secondary
          : Math.min(...this.secondaryYaxisSeries.map(ele => ele.min)) || this.boundSecondary[0],
        config.upper_bound_secondary !== undefined
          ? config.upper_bound_secondary
          : Math.max(...this.secondaryYaxisSeries.map(ele => ele.max)) || this.boundSecondary[1],
      ];
  }

  async getCache(key, compressed) {
    const data = await localForage.getItem(key + (compressed ? '' : '-raw'));
    return data ? (compressed ? decompress(data) : data) : null;
  }

  async setCache(key, data, compressed) {
    return compressed
      ? localForage.setItem(key, compress(data))
      : localForage.setItem(`${key}-raw`, data);
  }

  async updateEntity(entity, index, initStart, end) {
    if (!entity
      || !this.updateQueue.includes(entity.entity_id)
      || this.config.entities[index].show_graph === false
    ) return;
    this.updateQueue = this.updateQueue.filter(entry => entry !== entity.entity_id);

    let stateHistory = [];
    let start = initStart;
    let skipInitialState = false;

    const history = this.config.cache
      ? await this.getCache(entity.entity_id, this.config.useCompress)
      : undefined;
    if (history && history.hours_to_show === this.config.hours_to_show) {
      stateHistory = history.data;

      let currDataIndex = stateHistory.findIndex(item => new Date(item.last_changed) > initStart);
      if (currDataIndex !== -1) {
        if (currDataIndex > 0) {
          // include previous item
          currDataIndex -= 1;
          // but change it's last changed time
          stateHistory[currDataIndex].last_changed = initStart;
        }

        stateHistory = stateHistory.slice(currDataIndex, stateHistory.length);
        // skip initial state when fetching recent/not-cached data
        skipInitialState = true;
      } else {
        // there were no states which could be used in current graph so clearing
        stateHistory = [];
      }

      const lastFetched = new Date(history.last_fetched);
      if (lastFetched > start) {
        start = new Date(lastFetched - 1);
      }
    }

    let newStateHistory = await this.fetchRecent(entity.entity_id, start, end, skipInitialState);
    if (newStateHistory[0] && newStateHistory[0].length > 0) {
      // check if we should convert states to numeric values
      if (this.isStateAxis(this.getAxis(index))) {
        newStateHistory[0].forEach(item => this._convertState(item));
      }

      newStateHistory = newStateHistory[0].filter(item => !Number.isNaN(parseFloat(item.state)));
      newStateHistory = newStateHistory.map(item => ({
        last_changed: item.last_changed,
        state: item.state,
      }));
      stateHistory = [...stateHistory, ...newStateHistory];

      if (this.config.cache) {
        this
          .setCache(entity.entity_id, {
            hours_to_show: this.config.hours_to_show,
            last_fetched: new Date(),
            data: stateHistory,
          }, this.config.useCompress)
          .catch((err) => {
            log(err);
            localForage.clear();
          });
      }
    }

    if (stateHistory.length === 0) return;

    if (entity.entity_id === this.entity[0].entity_id) {
      this.updateExtrema();
    }

    if (this.config.entities[index].fixed_value === true) {
      const last = stateHistory[stateHistory.length - 1];
      this.Graph[index].history = [last, last];
    } else {
      this.Graph[index].history = stateHistory;
    }
  }

  async fetchRecent(entityId, start, end, skipInitialState) {
    let url = 'history/period';
    if (start) url += `/${start.toISOString()}`;
    url += `?filter_entity_id=${entityId}`;
    if (end) url += `&end_time=${end.toISOString()}`;
    if (skipInitialState) url += '&skip_initial_state';
    return this._hass.callApi('GET', url);
  }

  updateExtrema(history) {
    const { extrema, average } = this.config.show;
    this.abs = [
      ...(extrema ? [{
        type: 'min',
        ...getMin(history, 'state'),
      }] : []),
      ...(average ? [{
        type: 'avg',
        state: getAvg(history, 'state'),
      }] : []),
      ...(extrema ? [{
        type: 'max',
        ...getMax(history, 'state'),
      }] : []),
    ];
  }

  _convertState(res) {
    const resultIndex = this.config.state_map.map.findIndex(s => s.value === res.state);
    if (resultIndex === -1) {
      return;
    }

    res.state = resultIndex;
  }

  getEndDate() {
    const date = new Date();
    switch (this.config.group_by) {
      case 'date':
        date.setDate(date.getDate() + 1);
        date.setHours(0, 0, 0);
        break;
      case 'hour':
        date.setHours(date.getHours() + 1);
        date.setMinutes(0, 0);
        break;
      default:
        break;
    }
    return date;
  }

  setNextUpdate() {
    if (!this.config.update_interval) {
      const interval = 1 / this.config.points_per_hour;
      clearInterval(this.interval);
      this.interval = setInterval(() => {
        if (!this.updating) this.updateData();
      }, interval * ONE_HOUR);
    }
  }

  getCardSize() {
    return 3;
  }
}

customElements.define('mini-graph-card', MiniGraphCard);
