import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { knex } from '../db.js';
import * as utils from '../utils.js';

class ModernStore {
  constructor() {
    this.methods = new Map();
    this.context = {
      knex,
      utils,
    };

    // Bind dispatch to this instance
    this.dispatch = this.dispatch.bind(this);
  }

  registerMethod(name, handler, options = {}) {
    this.methods.set(name, {
      handler,
      options
    });
  }

  async loadMethods(directory) {
    try {
      const loadMethodsRecursively = async (currentPath, prefix = '') => {
        const files = await fs.readdir(currentPath, { withFileTypes: true });

        for (const file of files) {
          const fullPath = path.join(currentPath, file.name);

          if (file.isDirectory()) {
            await loadMethodsRecursively(fullPath, `${prefix}${file.name}/`);
            continue;
          }

          if (['index.js', 'store.js'].includes(file.name)) continue;

          if (path.extname(file.name) === '.js') {
            const directoryPath = prefix.slice(0, -1);
            const module = (await import(`file://${fullPath}`)).default;

            if (typeof module === 'function') {
              module({
                define: (name, handler, options = {}) => {
                  const apiPath = `api/${directoryPath}/${name}`;
                  this.registerMethod(apiPath, handler, options);
                }
              });
            }
          }
        }
      };

      await loadMethodsRecursively(directory);
    } catch (error) {
      console.error('Error loading methods:', error);
      throw error;
    }
  }

  async dispatch(method, payload = {}, context = {}) {
    try {
      const methodData = this.methods.get(method);

      if (!methodData) {
        throw new Error(`Method ${method} not found`);
      }

      // Gestisce le opzioni basate sul payload
      const options = typeof methodData.options === 'function'
        ? methodData.options(payload)
        : methodData.options;

      // Se useAuth è esplicitamente false nel payload, ignora l'auth
      const requiresAuth = payload.useAuth !== false && options.auth;

      if (requiresAuth && !context.authenticated) {
        throw new Error('Authentication required');
      }

      const mergedContext = {
        ...this.context,
        ...context,
        dispatch: this.dispatch, // Passa il dispatch bound nel contesto
      };

      return await methodData.handler(payload, mergedContext);
    } catch (error) {
      console.error(`Error executing method ${method}:`, error);
      throw error;
    }
  }

  listMethods() {
    return Array.from(this.methods.keys());
  }
}

// Crea e inizializza lo store
const createStore = async () => {
  const store = new ModernStore();
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  await store.loadMethods(path.join(__dirname, 'api'));

  return store;
};

const store = await createStore();

// Esporta sia il singleton che la classe per flessibilità
export { ModernStore };
export default store;