Component({
  properties: { preparations: { type: Array, value: [] }, types: { type: Array, value: [] } },
  methods: {
    choose(event) { this.triggerEvent('toggle', { type: event.currentTarget.dataset.type }) },
    edit(event) { this.triggerEvent('change', { index: event.currentTarget.dataset.index, field: event.currentTarget.dataset.field, value: event.detail.value }) },
    unit(event) { const pickerIndex = Number(event.detail.value); const preparation = this.data.preparations[event.currentTarget.dataset.index] || {}; const unit = preparation.units[pickerIndex] && preparation.units[pickerIndex].value; if (unit) this.triggerEvent('change', { index: event.currentTarget.dataset.index, field: 'unit', value: unit }) }
  }
})
