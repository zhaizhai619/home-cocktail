Component({
  properties: { item: { type: Object, value: {} }, index: { type: Number, value: 0 }, units: { type: Array, value: [] } },
  methods: {
    emit(event, extra) { this.triggerEvent(event, { index: this.data.index, ...extra }) },
    onNameTap() { this.emit('pickname') },
    onInput(event) { this.emit('change', { field: event.currentTarget.dataset.field, value: event.detail.value }) },
    onUnit(event) { this.emit('change', { field: 'unit', value: event.detail.value }) },
    onRemove() { this.emit('remove') }
  }
})
