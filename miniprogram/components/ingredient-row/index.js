Component({
  properties: { item: { type: Object, value: {} }, index: { type: Number, value: 0 }, preparationId: { type: String, value: '' }, units: { type: Array, value: [] }, categories: { type: Array, value: [] }, dragging: { type: Boolean, value: false } },
  methods: {
    emit(event, extra) { this.triggerEvent(event, { index: this.data.index, preparationId: this.data.preparationId, ...extra }) },
    onNameTap() { this.emit('pickname') },
    touchY(event) { const touch = event.touches && event.touches[0] || event.changedTouches && event.changedTouches[0]; return touch ? Number(touch.pageY || touch.clientY) : 0 },
    onDragStart(event) { this.emit('dragstart', { y: this.touchY(event) }) },
    onDragMove(event) { if (this.data.dragging) this.emit('dragmove', { y: this.touchY(event) }) },
    onDragEnd(event) { if (this.data.dragging) this.emit('dragend', { y: this.touchY(event) }) },
    onInput(event) { this.emit('change', { field: event.currentTarget.dataset.field, value: event.detail.value }) },
    onUnit(event) { const index = Number(event.detail.value); const unit = this.data.units[index] && this.data.units[index].value; if (unit) this.emit('change', { field: 'unit', value: unit }) },
    onCategory(event) { const index = Number(event.detail.value); const category = this.data.categories[index] && this.data.categories[index].key; if (category) this.emit('categorychange', { category }) },
    onRemove() { this.emit('remove') }
  }
})
