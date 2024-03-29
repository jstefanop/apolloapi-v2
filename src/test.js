const store = require('./store')

store.dispatch('api/auth/login', { password: 'abcdef' })
