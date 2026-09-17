// API pública:
//   StateMachine(initialState, context = {}) -> instância (também é o default export)
//     .register(name, stateModule) -> this
//       Registra um estado sob um nome. stateModule é um objeto no formato:
//         { enter(context, data), update(context, dt), render(context, ctx), exit(context) }
//       Todos os métodos do stateModule são opcionais.
//     .change(name, data) -> void
//       Chama exit(context) do estado atual (se houver) e enter(context, data) do novo.
//       Lança erro se `name` não tiver sido registrado via .register().
//     .update(dt) -> void
//       Delega para o update(context, dt) do estado atual. Na primeira chamada, se
//       nenhum .change() explícito foi feito ainda, transiciona automaticamente para
//       `initialState` (se ele tiver sido registrado).
//     .render(ctx) -> void
//       Delega para o render(context, ctx) do estado atual.
//     .currentName -> string | null (getter, nome do estado atual)
//     .context -> object (getter, o mesmo objeto `context` passado no construtor)

export default function StateMachine(initialState, context = {}) {
  const states = new Map()
  let currentName = null
  let current = null
  let started = false

  function register(name, stateModule) {
    states.set(name, stateModule)
    return machine
  }

  function change(name, data) {
    const next = states.get(name)
    if (!next) {
      throw new Error(`StateMachine: estado "${name}" não foi registrado via .register()`)
    }

    if (current && typeof current.exit === 'function') {
      current.exit(context)
    }

    currentName = name
    current = next
    started = true

    if (typeof current.enter === 'function') {
      current.enter(context, data)
    }
  }

  function update(dt) {
    if (!started) {
      if (initialState && states.has(initialState)) {
        change(initialState)
      } else {
        return
      }
    }

    if (current && typeof current.update === 'function') {
      current.update(context, dt)
    }
  }

  function render(ctx) {
    if (current && typeof current.render === 'function') {
      current.render(context, ctx)
    }
  }

  const machine = {
    register,
    change,
    update,
    render,
    get currentName() {
      return currentName
    },
    get context() {
      return context
    },
  }

  return machine
}

export { StateMachine }
