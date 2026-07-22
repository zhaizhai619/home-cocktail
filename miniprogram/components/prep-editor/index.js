Component({
  properties: { preparations: { type: Array, value: [] }, types: { type: Array, value: [] } },
  methods: {
    choose(event) { this.triggerEvent('toggle', { type: event.currentTarget.dataset.type }) },
    edit(event) { this.triggerEvent('change', { index: event.currentTarget.dataset.index, field: event.currentTarget.dataset.field, value: event.detail.value }) },
    unit(event) {
      const index = Number(event.currentTarget.dataset.index)
      const pickerIndex = Number(event.detail.value)
      const preparation = this.data.preparations[index] || {}
      const option = Array.isArray(preparation.units) ? preparation.units[pickerIndex] : null
      if (option) this.triggerEvent('change', { index, field: 'durationUnit', value: option.value })
    }
  }
})
