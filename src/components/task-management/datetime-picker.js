/**
 * Custom DateTime Picker
 * - Past dates are greyed out and unselectable
 * - For today, past hours and minutes are also greyed out
 * - Hours and minutes use scroll-wheel style
 */
export class DateTimePicker {
  constructor(inputEl) {
    this.input = inputEl;
    this.value = '';
    this.isOpen = false;

    // Build DOM
    this._build();
    this._bind();
  }

  _build() {
    // Wrapper
    this.dropdown = document.createElement('div');
    this.dropdown.className = 'dt-picker-dropdown';
    this.dropdown.style.display = 'none';

    // Calendar header (prev / month-year / next)
    const calHeader = document.createElement('div');
    calHeader.className = 'dt-picker-cal-header';

    this.btnPrev = document.createElement('button');
    this.btnPrev.type = 'button';
    this.btnPrev.className = 'dt-picker-nav';
    this.btnPrev.innerHTML = '&lsaquo;';

    this.labelMonth = document.createElement('span');
    this.labelMonth.className = 'dt-picker-month-label';

    this.btnNext = document.createElement('button');
    this.btnNext.type = 'button';
    this.btnNext.className = 'dt-picker-nav';
    this.btnNext.innerHTML = '&rsaquo;';

    calHeader.append(this.btnPrev, this.labelMonth, this.btnNext);

    // Weekday row
    const weekdays = document.createElement('div');
    weekdays.className = 'dt-picker-weekdays';
    ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach(d => {
      const s = document.createElement('span');
      s.textContent = d;
      weekdays.appendChild(s);
    });

    // Date grid
    this.dateGrid = document.createElement('div');
    this.dateGrid.className = 'dt-picker-date-grid';

    // Separator
    const sep = document.createElement('div');
    sep.className = 'dt-picker-sep';

    // Time wheel section
    const timeSection = document.createElement('div');
    timeSection.className = 'dt-picker-time-section';

    // Labels
    const hourLabel = document.createElement('div');
    hourLabel.className = 'dt-picker-wheel-label';
    hourLabel.textContent = 'Hour';

    const minLabel = document.createElement('div');
    minLabel.className = 'dt-picker-wheel-label';
    minLabel.textContent = 'Min';

    // Hour wheel
    this.hourWheel = document.createElement('div');
    this.hourWheel.className = 'dt-picker-wheel';

    this.hourList = document.createElement('div');
    this.hourList.className = 'dt-picker-wheel-list';
    this.hourWheel.appendChild(this.hourList);

    // Minute wheel
    this.minuteWheel = document.createElement('div');
    this.minuteWheel.className = 'dt-picker-wheel';

    this.minuteList = document.createElement('div');
    this.minuteList.className = 'dt-picker-wheel-list';
    this.minuteWheel.appendChild(this.minuteList);

    const hourCol = document.createElement('div');
    hourCol.className = 'dt-picker-wheel-col';
    hourCol.append(hourLabel, this.hourWheel);

    const minCol = document.createElement('div');
    minCol.className = 'dt-picker-wheel-col';
    minCol.append(minLabel, this.minuteWheel);

    timeSection.append(hourCol, minCol);

    // Left: calendar
    const calSection = document.createElement('div');
    calSection.className = 'dt-picker-cal-section';
    calSection.append(calHeader, weekdays, this.dateGrid);

    // Right: time
    timeSection.append(hourCol, minCol);

    this.dropdown.append(calSection, timeSection);

    // Insert after the input
    this.input.parentNode.style.position = this.input.parentNode.style.position || 'relative';
    this.input.parentNode.appendChild(this.dropdown);

    // Initial state
    const now = new Date();
    this.viewYear = now.getFullYear();
    this.viewMonth = now.getMonth();
    this.selectedDate = null;
    this.selectedHour = now.getHours();
    this.selectedMinute = now.getMinutes();

    this._renderCalendar();
    this._renderWheel(this.hourList, 0, 23, this.selectedHour, (v) => {
      this.selectedHour = v;
      this._onHourChange();
    });
    this._renderWheel(this.minuteList, 0, 59, this.selectedMinute, (v) => {
      this.selectedMinute = v;
      this._updateInput();
    });
  }

  _bind() {
    this.input.addEventListener('click', () => this.toggle());
    this.input.addEventListener('focus', () => this.open());

    this.btnPrev.addEventListener('click', () => {
      this.viewMonth--;
      if (this.viewMonth < 0) { this.viewMonth = 11; this.viewYear--; }
      this._renderCalendar();
      this._refreshTimeWheels();
    });

    this.btnNext.addEventListener('click', () => {
      this.viewMonth++;
      if (this.viewMonth > 11) { this.viewMonth = 0; this.viewYear++; }
      this._renderCalendar();
      this._refreshTimeWheels();
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!this.dropdown.contains(e.target) && e.target !== this.input && document.body.contains(e.target)) {
        this.close();
      }
    });
  }

  open() {
    const now = new Date();
    this.viewYear = now.getFullYear();
    this.viewMonth = now.getMonth();
    if (!this.selectedDate) {
      this.selectedHour = now.getHours();
      this.selectedMinute = now.getMinutes();
    }
    this._renderCalendar();
    this._refreshTimeWheels();
    this.dropdown.style.display = 'flex';
    this.isOpen = true;
  }

  close() {
    this.dropdown.style.display = 'none';
    this.isOpen = false;
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  /* ---- Calendar ---- */

  _renderCalendar() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    this.labelMonth.textContent = `${this._monthName(this.viewMonth)} ${this.viewYear}`;

    // Disable prev button if it would go to a past month
    const prevMonth = new Date(this.viewYear, this.viewMonth, 0);
    this.btnPrev.disabled = prevMonth < today;

    this.dateGrid.innerHTML = '';

    const firstDay = new Date(this.viewYear, this.viewMonth, 1).getDay();
    const daysInMonth = new Date(this.viewYear, this.viewMonth + 1, 0).getDate();

    // Leading blanks
    for (let i = 0; i < firstDay; i++) {
      const blank = document.createElement('span');
      blank.className = 'dt-picker-day dt-picker-day-disabled';
      this.dateGrid.appendChild(blank);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dt-picker-day';
      btn.textContent = d;

      const dateObj = new Date(this.viewYear, this.viewMonth, d);
      const isPast = dateObj < today;

      if (isPast) {
        btn.classList.add('dt-picker-day-disabled');
        btn.disabled = true;
      } else {
        btn.addEventListener('click', () => {
          this.selectedDate = new Date(this.viewYear, this.viewMonth, d);
          // Clamp hour/minute for today
          if (this._isToday(this.selectedDate)) {
            if (this.selectedHour < now.getHours()) {
              this.selectedHour = now.getHours();
            }
            if (this.selectedHour === now.getHours() && this.selectedMinute < now.getMinutes()) {
              this.selectedMinute = now.getMinutes();
            }
          }
          this._refreshTimeWheels();
          this._highlightDay(btn);
          this._updateInput();
        });
      }

      // Highlight selected
      if (this.selectedDate &&
          this.selectedDate.getFullYear() === this.viewYear &&
          this.selectedDate.getMonth() === this.viewMonth &&
          this.selectedDate.getDate() === d) {
        btn.classList.add('dt-picker-day-selected');
      }

      this.dateGrid.appendChild(btn);
    }
  }

  _highlightDay(btn) {
    this.dateGrid.querySelectorAll('.dt-picker-day-selected')
      .forEach(el => el.classList.remove('dt-picker-day-selected'));
    btn.classList.add('dt-picker-day-selected');
  }

  /* ---- Scroll Wheel ---- */

  _renderWheel(container, min, max, selected, onSelect) {
    container.innerHTML = '';
    const now = new Date();
    const isToday = this.selectedDate && this._isToday(this.selectedDate);
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    for (let v = min; v <= max; v++) {
      const item = document.createElement('div');
      item.className = 'dt-picker-wheel-item';
      item.textContent = String(v).padStart(2, '0');
      item.setAttribute('data-value', v);

      // Check disabled state
      let disabled = false;
      if (isToday) {
        if (container === this.hourList && v < currentHour) {
          disabled = true;
        }
        if (container === this.minuteList && this.selectedHour === currentHour && v < currentMinute) {
          disabled = true;
        }
      }

      if (disabled) {
        item.classList.add('dt-picker-wheel-disabled');
      } else {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          // Remove old active
          container.querySelector('.dt-picker-wheel-active')
            ?.classList.remove('dt-picker-wheel-active');
          item.classList.add('dt-picker-wheel-active');
          onSelect(v);
          this._scrollToItem(container, item);
        });
      }

      if (v === selected && !disabled) {
        item.classList.add('dt-picker-wheel-active');
      }

      container.appendChild(item);
    }

    // Scroll selected into center view
    requestAnimationFrame(() => {
      const activeItem = container.querySelector('.dt-picker-wheel-active');
      if (activeItem) {
        this._scrollToItem(container, activeItem, false);
      } else {
        // Scroll to first enabled item
        const firstEnabled = container.querySelector('.dt-picker-wheel-item:not(.dt-picker-wheel-disabled)');
        if (firstEnabled) this._scrollToItem(container, firstEnabled, false);
      }
    });
  }

  _scrollToItem(container, item, smooth = true) {
    const containerRect = container.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const offset = itemRect.top - containerRect.top;
    const target = container.scrollTop + offset - (container.clientHeight / 2) + (item.clientHeight / 2);
    container.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' });
  }

  _refreshTimeWheels() {
    this._renderWheel(this.hourList, 0, 23, this.selectedHour, (v) => {
      this.selectedHour = v;
      this._onHourChange();
    });
    this._renderWheel(this.minuteList, 0, 59, this.selectedMinute, (v) => {
      this.selectedMinute = v;
      this._updateInput();
    });
  }

  _onHourChange() {
    const now = new Date();
    const isToday = this.selectedDate && this._isToday(this.selectedDate);
    if (isToday && this.selectedHour === now.getHours() && this.selectedMinute < now.getMinutes()) {
      this.selectedMinute = now.getMinutes();
    }
    this._refreshTimeWheels();
    this._updateInput();
  }

  /* ---- Helpers ---- */

  _updateInput() {
    if (!this.selectedDate) return;
    const y = this.selectedDate.getFullYear();
    const mo = String(this.selectedDate.getMonth() + 1).padStart(2, '0');
    const d = String(this.selectedDate.getDate()).padStart(2, '0');
    const h = String(this.selectedHour).padStart(2, '0');
    const mi = String(this.selectedMinute).padStart(2, '0');
    this.value = `${y}-${mo}-${d}T${h}:${mi}`;
    this.input.value = `${y}-${mo}-${d} ${h}:${mi}`;
    this.input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  _isToday(dateObj) {
    const now = new Date();
    return dateObj.getFullYear() === now.getFullYear() &&
           dateObj.getMonth() === now.getMonth() &&
           dateObj.getDate() === now.getDate();
  }

  _monthName(m) {
    return ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'][m];
  }

  getValue() {
    return this.value;
  }

  reset() {
    this.value = '';
    this.input.value = '';
    this.selectedDate = null;
    const now = new Date();
    this.selectedHour = now.getHours();
    this.selectedMinute = now.getMinutes();
    this.viewYear = now.getFullYear();
    this.viewMonth = now.getMonth();
  }
}
