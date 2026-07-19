Component({
  properties: { item: { type: Object, value: {} }, index: { type: Number, value: 0 }, units: { type: Array, value: [] }, categories: { type: Array, value: [] } },
  methods: {
    emit(event, extra) { this.triggerEvent(event, { index: this.data.index, ...extra }) },
    onNameTap() { this.emit('pickname') },
    onInput(event) { this.emit('change', { field: event.currentTarget.dataset.field, value: event.detail.value }) },
    onUnit(event) { const index = Number(event.detail.value); const unit = this.data.units[index] && this.data.units[index].value; if (unit) this.emit('change', { field: 'unit', value: unit }) },
    onCategory(event) { const index = Number(event.detail.value); const category = this.data.categories[index] && this.data.categories[index].key; if (category) this.emit('categorychange', { category }) },
    onAlcoholic(event) { this.emit('alcoholicchange', { value: event.detail.value === true }) },
    onRemove() { this.emit('remove') }
  }
})
