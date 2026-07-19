Component({
  properties: {
    recipe: { type: Object, value: {} }
  },
  methods: {
    onSelect() {
      const recipe = this.data.recipe || {}
      this.triggerEvent('select', { id: recipe.id || '' })
    }
  }
})
