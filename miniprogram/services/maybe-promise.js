function settleOperation(operation, onSuccess, onFailure) {
  try {
    const value = operation()
    if (value && typeof value.then === 'function') {
      return Promise.resolve(value).then(
        (resolved) => {
          try { return onSuccess(resolved) } catch (error) { return onFailure(error) }
        },
        onFailure
      )
    }
    return onSuccess(value)
  } catch (error) {
    return onFailure(error)
  }
}

module.exports = { settleOperation }
