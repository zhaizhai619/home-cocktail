Component({
  properties: { preparations: { type: Array, value: [] }, types: { type: Array, value: [] } },
  methods: {
    choose(event) { this.triggerEvent('toggle', { type: event.currentTarget.dataset.type }) },
    edit(event) { this.triggerEvent('change', { index: event.currentTarget.dataset.index, field: event.currentTarget.dataset.field, value: event.detail.value }) },
    unit(event) { this.triggerEvent('change', { index: event.currentTarget.dataset.index, field: 'unit', value: event.detail.value }) }
  }
})
