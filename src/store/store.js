const { Store } = require('backend-store')
const { loadStore } = require('backend-helpers')
const config = require('config')
const { knex } = require('./../db')
const utils = require('./../utils')

const patchStore = function (dispatch) {
  Store.prototype.dispatch = function (method, payload, context = {}, options) {
    return dispatch.call(this, method, payload, context, options)
  }
}
patchStore(Store.prototype.dispatch)

const store = loadStore({
  loadMethods: {
    path: __dirname,
    filter ({ relativePath }) {
      // omit index.js and store.js files
      return !['index.js', 'store.js'].includes(relativePath) && relativePath.match(/\.js$/)
    }
  },
  logger: {},
  methodContext: {
    knex,
    utils
  }
})

module.exports = store
