# useForm — Vue 3 Form Library

> A lightweight, Vue-native form management library inspired by React Hook Form.  
> Built on Vue's reactivity system — no manual subscriptions, no unnecessary re-renders.

---

## Table of Contents

1. [Core Philosophy](#1-core-philosophy)
2. [Architecture Overview](#2-architecture-overview)
3. [Storage Layer](#3-storage-layer)
4. [Fields Layer](#4-fields-layer)
5. [Validation Engine](#5-validation-engine)
6. [Public Methods](#6-public-methods)
7. [Context System](#7-context-system)
8. [External Resolvers](#8-external-resolvers)
9. [Full API Reference](#9-full-api-reference)
10. [Complete Examples](#10-complete-examples)

---

## 1. Core Philosophy

### Why not `useState` / `ref` per field?

Most form libraries store each field value in component state. Every keystroke triggers a re-render of the entire form tree. This is the problem React Hook Form solved with DOM refs — and the same problem this library solves using Vue's fine-grained reactivity.

```
Traditional approach (BAD):
  User types → setState(value) → entire form re-renders → all fields re-render

This library (GOOD):
  User types → reactive._values.email = val → only components
               that READ email re-render (Vue tracks this automatically)
```

### Key design decisions

| Decision | Reason |
|---|---|
| Single `reactive({})` for all values | Vue tracks per-key access — only readers of that key re-render |
| `computed` for each field's `v-model` | Getter/setter pair — reads from store, writes back with validation |
| No manual event bus | Vue's reactivity IS the event bus |
| `provide/inject` for context | Replaces React's `<FormProvider>` — no prop drilling |
| `readonly()` on public state | Prevents accidental mutation from outside |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    useForm(options)                      │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │   _values    │  │   _errors    │  │     _meta     │ │
│  │  reactive()  │  │  reactive()  │  │  reactive()   │ │
│  │              │  │              │  │               │ │
│  │ email: ''    │  │ email: null  │  │ isValid: true │ │
│  │ password: '' │  │              │  │ isDirty: false│ │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘ │
│         │                 │                   │         │
│         └────────┬────────┘                   │         │
│                  ▼                             │         │
│  ┌───────────────────────────────────────────┐│         │
│  │                  fields                   ││         │
│  │                                           ││         │
│  │  fields.email = {                         ││         │
│  │    model: computed({ get, set })  ◄───────┘│         │
│  │    error: computed(() => ...)              │         │
│  │    value: getter                           │         │
│  │    attrs: { onBlur }                       │         │
│  │  }                                         │         │
│  └───────────────────────────────────────────┘         │
│                                                         │
│  handleSubmit()  reset()  setError()  clearErrors()     │
└───────────────────────────────┬─────────────────────────┘
                                │ provide(FORM_KEY)
                    ┌───────────▼────────────┐
                    │   Child Components     │
                    │                        │
                    │  useFormContext()       │
                    │  useField('email')      │
                    └────────────────────────┘
```

### Data flow on user input

```
User types in <input v-model="fields.email.model">
    │
    ▼
computed setter fires
    │
    ├─► _values.email = newValue       (reactive update, no setState)
    │
    ├─► _dirty.email = (val !== default)
    │
    └─► validate('email', rules, val)
            │
            ├─► runRules(val, rules)   (built-in) or resolver(values)
            │
            ├─► _errors.email = 'message'   (if invalid)
            │   or delete _errors.email     (if valid)
            │
            └─► _meta.isValid = Object.keys(_errors).length === 0
                    │
                    ▼
            fields.email.error (computed) updates automatically
            Only the error <span> re-renders — nothing else
```

### Data flow on submit

```
User clicks submit → handleSubmit(onValid) fires
    │
    ├─► _meta.isSubmitting = true
    ├─► _meta.isSubmitted  = true
    ├─► _meta.submitCount++
    │
    ├─► validateAll()
    │       │
    │       ├─► runs validate() for every field in schema
    │       └─► returns true/false
    │
    ├─► if valid   → await onValid(deepCopy(_values))
    │   if invalid → onInvalid?.(_errors)
    │
    └─► _meta.isSubmitting = false
```

---

## 3. Storage Layer

Three separate `reactive()` objects act as the single source of truth.
Vue tracks which computed properties read from which keys
and updates only those properties when a key changes.

```js
// Internal storage — never exposed directly outside useForm()

const _values = reactive({})
// Holds current field values.
// Keys are field names (supports dot-notation for nested: 'address.city')
// Example after init: { email: '', password: '', age: 0 }

const _errors = reactive({})
// Holds validation error messages.
// Key present   → field has an error
// Key absent    → field is valid
// Example: { email: 'Invalid email format' }

const _touched = reactive({})
// Tracks which fields the user has interacted with (focused + blurred).
// Used to show errors only after the user has visited the field.
// Example: { email: true }

const _dirty = reactive({})
// Tracks which fields have been changed from their default value.
// Example: { email: true, password: false }

const _meta = reactive({
  isSubmitting: false,  // true while handleSubmit's async callback is running
  isSubmitted:  false,  // true after the first submit attempt
  submitCount:  0,      // total number of submit attempts
  isValid:      true,   // false if _errors has any key
  isDirty:      false,  // true if any field in _dirty is true
})
```

### Why separate objects instead of one big object?

```js
// BAD — one big object per field:
const fields = reactive({
  email: { value: '', error: null, touched: false }
})
// Vue tracks the entire 'email' object as a dependency.
// Changing 'error' causes every component reading 'email.value' to re-render.

// GOOD — separate concerns:
const _values = reactive({ email: '' })
const _errors = reactive({})
// Vue tracks keys independently.
// Changing _errors.email only re-renders components that read _errors.email.
// Components reading _values.email are untouched.
```

### Nested field paths

The library supports dot-notation field names for nested data structures.
Three utility functions handle reading, writing, and deleting nested paths:

```js
// get(obj, 'address.city') → obj.address?.city
function get(obj, path) {
  return path.split('.').reduce((acc, key) => acc?.[key], obj)
}

// set(obj, 'address.city', 'Kyiv') → obj.address = { city: 'Kyiv' }
// Creates intermediate objects if they don't exist
function set(obj, path, value) {
  const keys = path.split('.')
  const last = keys.pop()
  const target = keys.reduce((acc, key) => {
    if (acc[key] === undefined) acc[key] = {}
    return acc[key]
  }, obj)
  target[last] = value
}

// unset(obj, 'address.city') → delete obj.address.city
function unset(obj, path) {
  const keys = path.split('.')
  const last = keys.pop()
  const target = keys.reduce((acc, key) => acc?.[key], obj)
  if (target) delete target[last]
}
```

```js
// Usage example — nested address form:
const { fields } = useForm({
  fields: {
    'address.street': { default: '', required: true },
    'address.city':   { default: '', required: true },
    'address.zip':    { default: '', pattern: { value: /^\d{5}$/, message: 'Must be 5 digits' } },
  }
})

// Template:
// <input v-model="fields['address.city'].model" />
// Submitted value: { address: { street: '...', city: '...', zip: '...' } }
```

### Initialization

When `useForm()` is called, `_values` is populated from the schema:

```js
for (const [name, rules] of Object.entries(schema)) {
  // Priority: options.defaults[name] > rules.default > ''
  const defaultVal = defaults[name] ?? rules.default ?? ''
  set(_values, name, defaultVal)
}

// Snapshot of defaults saved for reset() and dirty tracking
const _defaultValues = JSON.parse(JSON.stringify(_values))
```

---

## 4. Fields Layer

`fields` is the object your template interacts with.
It is created once during `useForm()` and never recreated.
Each field descriptor is a plain object containing computed properties and getters.

```js
const fields = Object.fromEntries(
  Object.entries(schema).map(([name, rules]) => {

    // ── model ──────────────────────────────────────────────────
    // computed with get + set.
    // This is what v-model binds to.
    const model = computed({

      get() {
        // Reads from _values.
        // Vue registers this as a dependency — when _values[name] changes,
        // only the component that rendered this computed re-evaluates.
        return get(_values, name)
      },

      set(val) {
        // 1. Write to storage (reactive — triggers Vue's dependency graph)
        set(_values, name, val)

        // 2. Track dirty state
        const isFieldDirty = val !== get(_defaultValues, name)
        set(_dirty, name, isFieldDirty)
        _meta.isDirty = Object.values(_dirty).some(Boolean)

        // 3. Validate based on mode setting
        // 'onChange' — validate on every keystroke
        // 'onSubmit'  — validate only on submit (but re-validate after first submit)
        if (mode === 'onChange' || (_meta.isSubmitted && mode === 'onSubmit')) {
          validate(name, rules, val)
        }
      },
    })

    // ── onBlur handler ─────────────────────────────────────────
    function onBlur() {
      set(_touched, name, true)
      // 'onBlur'    — validate when user leaves the field
      // 'onTouched' — first validate onBlur, then onChange after first touch
      if (mode === 'onBlur' || mode === 'onTouched') {
        validate(name, rules, get(_values, name))
      }
    }

    return [name, {
      model,                                          // computed for v-model
      get value() { return get(_values, name) },      // plain getter
      error:   computed(() => get(_errors, name) ?? null),  // computed error
      get touched() { return get(_touched, name) ?? false },
      get dirty()   { return get(_dirty,   name) ?? false },
      attrs: { onBlur },                              // bind with v-bind
    }]
  })
)
```

### How v-model works with computed

Vue's `v-model` on a native `<input>` is sugar for `:value` + `@input`:

```html
<!-- These are equivalent: -->
<input v-model="fields.email.model" />

<input
  :value="fields.email.model"
  @input="fields.email.model = $event.target.value"
/>
```

When the user types:
1. `@input` fires → calls the computed **setter**
2. Setter writes to `_values.email` (reactive)
3. Vue sees `_values.email` changed → re-evaluates computed **getter**
4. `:value` updates in the DOM

No `forceUpdate`, no manual subscriptions, no event bus.

### Field descriptor structure

```js
// fields.email:
{
  model: ComputedRef,    // Use with v-model="fields.email.model"
  value: any,            // Use to read:  const val = fields.email.value
  error: ComputedRef,    // Use with:     v-if="fields.email.error"
  touched: boolean,      // Use with:     v-if="fields.email.touched && fields.email.error"
  dirty: boolean,        // Use with:     :class="{ dirty: fields.email.dirty }"
  attrs: {
    onBlur: Function     // Use with:     v-bind="fields.email.attrs"
  }
}
```

### Recommended template pattern

```vue
<template>
  <!-- Minimal — just v-model and error -->
  <input v-model="fields.email.model" />
  <span class="error">{{ fields.email.error }}</span>

  <!-- With onBlur (needed for mode: 'onBlur' or 'onTouched') -->
  <input
    v-model="fields.email.model"
    v-bind="fields.email.attrs"
  />

  <!-- Show error only after user has visited the field -->
  <span v-if="fields.email.touched && fields.email.error" class="error">
    {{ fields.email.error }}
  </span>

  <!-- Dirty indicator -->
  <input
    v-model="fields.username.model"
    :class="{ 'is-dirty': fields.username.dirty }"
  />
</template>
```

---

## 5. Validation Engine

### Built-in rules

All rules are processed in order. The first failing rule sets the error.
Rules are defined inline in the field schema.

#### `required`

```js
// Boolean — uses default message
required: true

// String — uses as the error message
required: 'Email is required'

// Fails when: value === '' || value === null || value === undefined
```

#### `minLength` / `maxLength`

```js
// Number shorthand
minLength: 8

// Object with custom message
minLength: { value: 8, message: 'Password must be at least 8 characters' }

maxLength: { value: 100, message: 'Too long' }

// Checks: value.length < min (or > max)
```

#### `min` / `max`

```js
// For numeric fields
min: 0
max: { value: 120, message: 'Age cannot exceed 120' }

// Checks: Number(value) < min (or > max)
```

#### `pattern`

```js
pattern: {
  value: /^\S+@\S+\.\S+$/,
  message: 'Enter a valid email address',
}

// Checks: regex.test(String(value))
```

#### `validate`

```js
// Single function
validate: (value) => {
  if (value === 'admin') return 'This username is reserved'
  return true   // or undefined — means valid
}

// Object of named validators (all are checked)
validate: {
  noSpaces:    (v) => !/\s/.test(v) || 'No spaces allowed',
  notReserved: (v) => !['admin', 'root'].includes(v) || 'Username is reserved',
  // Async validator — e.g. check availability on server
  isAvailable: async (v) => {
    const taken = await api.checkUsername(v)
    return !taken || 'This username is already taken'
  },
}
```

### Complete schema example

```js
const { fields, handleSubmit } = useForm({
  mode: 'onChange',
  fields: {

    username: {
      default: '',
      required: 'Username is required',
      minLength: { value: 3,  message: 'At least 3 characters' },
      maxLength: { value: 20, message: 'Maximum 20 characters' },
      pattern: {
        value: /^[a-z0-9_]+$/,
        message: 'Only lowercase letters, numbers, and underscores',
      },
      validate: {
        noAdmin: (v) => v !== 'admin' || 'This name is not allowed',
        isAvailable: async (v) => {
          if (v.length < 3) return true  // skip — minLength will catch it
          const taken = await checkUsernameAPI(v)
          return !taken || 'Username is already taken'
        },
      },
    },

    email: {
      default: '',
      required: 'Email is required',
      pattern: {
        value: /^\S+@\S+\.\S+$/,
        message: 'Enter a valid email',
      },
    },

    age: {
      default: '',
      required: true,
      min: { value: 18,  message: 'You must be at least 18 years old' },
      max: { value: 120, message: 'Please enter a valid age' },
    },

    bio: {
      default: '',
      maxLength: { value: 500, message: 'Bio cannot exceed 500 characters' },
      // No required — optional field
    },

  },
})
```

### The `validate()` function internals

```js
// Called on every field change (if mode allows) and on submit.
async function validate(name, rules, value) {
  let error = null

  if (resolver) {
    // External resolver validates ALL fields at once.
    // We extract only this field's error from the result.
    const result = await resolver({ ..._values })
    error = result.errors?.[name]?.message ?? null
  } else {
    // Built-in engine — processes rules in order, stops at first error.
    error = await runRules(value, rules)
  }

  if (error) {
    set(_errors, name, error)      // reactive write → field.error updates
  } else {
    unset(_errors, name)           // reactive delete → field.error becomes null
  }

  // Recompute global validity
  _meta.isValid = Object.keys(_errors).length === 0

  return !error
}
```

### The `runRules()` function internals

```js
async function runRules(value, rules) {
  const str = String(value ?? '')  // for string rules
  const num = Number(value)         // for numeric rules

  // required — checked first, before length/pattern
  if (rules.required) {
    const empty = value === '' || value === null || value === undefined
    if (empty) return typeof rules.required === 'string'
      ? rules.required
      : 'This field is required'
  }

  // minLength
  if (rules.minLength !== undefined) {
    const { value: min, message } = normalizeRule(rules.minLength)
    if (str.length < min) return message ?? `Minimum ${min} characters`
  }

  // maxLength
  if (rules.maxLength !== undefined) {
    const { value: max, message } = normalizeRule(rules.maxLength)
    if (str.length > max) return message ?? `Maximum ${max} characters`
  }

  // min (numeric)
  if (rules.min !== undefined) {
    const { value: min, message } = normalizeRule(rules.min)
    if (num < min) return message ?? `Minimum value is ${min}`
  }

  // max (numeric)
  if (rules.max !== undefined) {
    const { value: max, message } = normalizeRule(rules.max)
    if (num > max) return message ?? `Maximum value is ${max}`
  }

  // pattern
  if (rules.pattern) {
    const { value: regex, message } = rules.pattern
    if (!regex.test(str)) return message ?? 'Invalid format'
  }

  // validate — custom functions, run in parallel
  if (rules.validate) {
    const validators = typeof rules.validate === 'function'
      ? { _: rules.validate }
      : rules.validate

    for (const fn of Object.values(validators)) {
      const result = await fn(value)
      if (result !== true && result !== undefined) {
        return typeof result === 'string' ? result : 'Invalid value'
      }
    }
  }

  return null  // no error
}
```

### Validation modes

| Mode | When validation runs |
|---|---|
| `'onSubmit'` (default) | Only when the form is submitted. After first submit, re-validates on change. |
| `'onChange'` | On every keystroke. Most responsive, slightly more CPU. |
| `'onBlur'` | When the user leaves the field (focus out). |
| `'onTouched'` | First validation on blur, then on every change after that. |
| `'all'` | On both change and blur. |

```js
// Set mode for the entire form:
useForm({ mode: 'onChange', fields: { ... } })
```

---

## 6. Public Methods

### `handleSubmit(onValid, onInvalid?)`

Wraps your submit logic. Returns an async function to bind to `@submit.prevent`.

```js
const onSubmit = handleSubmit(
  // Called when all fields are valid
  async (values) => {
    // values is a deep copy of _values — safe to mutate
    // { email: 'user@example.com', password: 'secret123' }
    await api.login(values)
    router.push('/dashboard')
  },

  // Called when validation fails (optional)
  (errors) => {
    // errors: { email: 'Invalid email', password: 'Too short' }
    console.log('Form has errors:', errors)
    // Useful for analytics, scrolling to first error, etc.
  }
)
```

```vue
<template>
  <form @submit.prevent="onSubmit">
    ...
    <button type="submit" :disabled="formState.isSubmitting">
      {{ formState.isSubmitting ? 'Saving...' : 'Submit' }}
    </button>
  </form>
</template>
```

Internal flow:

```js
function handleSubmit(onValid, onInvalid) {
  return async (event) => {
    event?.preventDefault?.()

    _meta.isSubmitting = true   // disable button, show spinner
    _meta.isSubmitted  = true   // future onChange will now validate
    _meta.submitCount++

    try {
      const valid = await validateAll()   // runs all validators

      if (valid) {
        // Deep copy prevents the callback from mutating internal state
        await onValid(JSON.parse(JSON.stringify(_values)))
      } else {
        onInvalid?.({ ..._errors })
      }
    } finally {
      _meta.isSubmitting = false  // always restore, even on throw
    }
  }
}
```

### `reset(newValues?)`

Resets all fields to defaults. Clears errors, touched, and dirty states.

```js
// Reset to original defaults (from schema)
reset()

// Reset with new values — becomes the new baseline for dirty tracking
reset({
  email: 'prefilled@example.com',
  password: '',
})
```

```js
// Practical use — reset after successful submit:
const onSubmit = handleSubmit(async (values) => {
  await api.createPost(values)
  reset()   // clear the form
})

// Or reset to server data after loading:
const post = await api.getPost(id)
reset({
  title:   post.title,
  content: post.content,
})
```

### `setError(name, message)`

Programmatically set a field error. Useful for server-side validation errors.

```js
const onSubmit = handleSubmit(async (values) => {
  try {
    await api.register(values)
  } catch (err) {
    if (err.code === 'EMAIL_TAKEN') {
      // Set a server error directly on the field
      setError('email', 'This email is already registered')
    }
    if (err.code === 'USERNAME_TAKEN') {
      setError('username', 'This username is already taken')
    }
  }
})
```

### `clearErrors(name?)`

Remove errors — either for a specific field or all at once.

```js
// Clear error for one field
clearErrors('email')

// Clear all errors
clearErrors()

// Use case — clear server errors when user starts typing again:
watch(() => fields.email.value, () => {
  if (serverError.value) {
    clearErrors('email')
    serverError.value = null
  }
})
```

### `setValue(name, value)`

Programmatically set a field's value. Runs through the same setter as v-model —
triggers validation if mode allows.

```js
// Fill email from URL param
setValue('email', route.query.email ?? '')

// Reset just one field
setValue('password', '')

// Set computed value
setValue('fullName', `${firstName} ${lastName}`)
```

### `getValue(name?)`

Read field value(s) without reactivity (returns a snapshot, not a ref).

```js
// Get one field
const email = getValue('email')   // 'user@example.com'

// Get all values as a plain object (deep copy)
const data = getValue()
// { email: 'user@example.com', password: '...' }
```

### `formState`

Readonly reactive object with form meta-information.
Wrap in `watchEffect` or use directly in template.

```js
const { formState } = useForm({ ... })

// Available properties:
formState.isSubmitting   // boolean — submit in progress
formState.isSubmitted    // boolean — submitted at least once
formState.submitCount    // number  — total submit attempts
formState.isValid        // boolean — no validation errors
formState.isDirty        // boolean — any field changed from default
```

```vue
<template>
  <!-- Disable submit while in progress -->
  <button :disabled="formState.isSubmitting">
    {{ formState.isSubmitting ? 'Saving...' : 'Save' }}
  </button>

  <!-- Warn user about unsaved changes -->
  <div v-if="formState.isDirty" class="unsaved-warning">
    You have unsaved changes
  </div>

  <!-- Show global invalid state -->
  <p v-if="formState.isSubmitted && !formState.isValid" class="form-error">
    Please fix the errors above before submitting
  </p>

  <!-- Submit counter (useful for debugging) -->
  <small>Submit attempts: {{ formState.submitCount }}</small>
</template>
```

---

## 7. Context System

The context system lets deeply nested child components access the form
without passing props through every level. Equivalent to `<FormProvider>` in React Hook Form.

### How it works

```
Parent component calls useForm()
  │
  └─► provide(FORM_KEY, { fields, formState, handleSubmit, ... })
          │
          └─► Any descendant component can call:
                inject(FORM_KEY)         — raw access
                useFormContext()         — with error handling
                useField('fieldName')    — field-specific access
```

### `useFormContext()`

Returns the full form context. Use when you need access to multiple form methods.

```js
// AnyChildComponent.vue
import { useFormContext } from './useForm'

const {
  fields,
  formState,
  handleSubmit,
  reset,
  setError,
  clearErrors,
  setValue,
  getValue,
} = useFormContext()
```

### `useField(name)`

Returns the descriptor for a single field. Use when building reusable input components.

```js
// EmailInput.vue
import { useField } from './useForm'

const field = useField('email')
// field.model   — v-model
// field.error   — computed error
// field.attrs   — onBlur etc.
// field.touched — boolean
// field.dirty   — boolean
```

### Building a reusable input component

```vue
<!-- FormInput.vue -->
<!-- A fully self-contained input that connects to the parent form via context -->
<script setup>
import { useField } from './useForm'

const props = defineProps({
  name:        { type: String,  required: true },
  label:       { type: String,  default: '' },
  type:        { type: String,  default: 'text' },
  placeholder: { type: String,  default: '' },
})

// Connects to the nearest parent form automatically
const field = useField(props.name)
</script>

<template>
  <div class="form-field" :class="{ 'has-error': field.error, 'is-dirty': field.dirty }">
    <label v-if="label" :for="props.name">{{ label }}</label>

    <input
      :id="props.name"
      v-model="field.model"
      v-bind="field.attrs"
      :type="type"
      :placeholder="placeholder"
      :class="{ 'input-error': field.error }"
    />

    <transition name="fade">
      <p v-if="field.error" class="error-message">
        {{ field.error }}
      </p>
    </transition>
  </div>
</template>
```

```vue
<!-- Usage — no props needed for validation or error display -->
<script setup>
import { useForm } from './useForm'
import FormInput from './FormInput.vue'

const { handleSubmit } = useForm({
  mode: 'onBlur',
  fields: {
    email:    { required: true, pattern: { value: /^\S+@\S+$/, message: 'Invalid email' } },
    password: { required: true, minLength: 8 },
    username: { required: true, minLength: 3 },
  }
})
</script>

<template>
  <form @submit.prevent="handleSubmit(onSubmit)">
    <!-- Each component finds its own field from context -->
    <FormInput name="email"    label="Email"    type="email" />
    <FormInput name="password" label="Password" type="password" />
    <FormInput name="username" label="Username" />

    <button type="submit">Create Account</button>
  </form>
</template>
```

---

## 8. External Resolvers

Resolvers let you use schema-validation libraries like Zod or Yup
as the validation engine. When a resolver is provided, the built-in
rule engine is bypassed — the resolver handles all validation.

### Resolver interface

Any resolver must conform to this async function signature:

```ts
type Resolver = (values: Record<string, any>) => Promise<{
  values: Record<string, any>   // parsed/coerced values on success
  errors: Record<string, {      // error map on failure
    message: string
  }>
}>
```

### `zodResolver(schema)`

```js
import { z } from 'zod'
import { useForm, zodResolver } from './useForm'

// Define your schema with Zod
const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Enter a valid email address'),

  password: z
    .string()
    .min(1, 'Password is required')
    .min(8, 'Password must be at least 8 characters'),
})

// Pass the resolver to useForm
const { fields, handleSubmit } = useForm({
  resolver: zodResolver(loginSchema),
  fields: {
    email:    { default: '' },   // defaults still come from fields
    password: { default: '' },   // validation rules come from Zod schema
  },
})
```

Internal implementation:

```js
function zodResolver(schema) {
  return async (values) => {
    // safeParse doesn't throw — returns { success, data, error }
    const result = schema.safeParse(values)

    if (result.success) {
      return { values: result.data, errors: {} }
    }

    // Flatten Zod's issue array into { fieldName: { message } }
    const errors = {}
    for (const issue of result.error.issues) {
      const path = issue.path.join('.')     // ['address', 'city'] → 'address.city'
      if (!errors[path]) {
        errors[path] = { message: issue.message }
      }
    }

    return { values: {}, errors }
  }
}
```

### `yupResolver(schema)`

```js
import * as yup from 'yup'
import { useForm, yupResolver } from './useForm'

const registrationSchema = yup.object({
  username: yup
    .string()
    .required('Username is required')
    .min(3, 'At least 3 characters')
    .matches(/^[a-z0-9_]+$/, 'Only lowercase letters, numbers, and underscores'),

  email: yup
    .string()
    .required('Email is required')
    .email('Enter a valid email'),

  age: yup
    .number()
    .required('Age is required')
    .min(18, 'Must be at least 18 years old')
    .typeError('Age must be a number'),

  confirmPassword: yup
    .string()
    .required('Please confirm your password')
    .oneOf([yup.ref('password')], 'Passwords do not match'),
})

const { fields, handleSubmit } = useForm({
  resolver: yupResolver(registrationSchema),
  fields: {
    username:        { default: '' },
    email:           { default: '' },
    age:             { default: '' },
    password:        { default: '' },
    confirmPassword: { default: '' },
  }
})
```

Internal implementation:

```js
function yupResolver(schema) {
  return async (values) => {
    try {
      // abortEarly: false — collect ALL errors, not just the first
      const data = await schema.validate(values, { abortEarly: false })
      return { values: data, errors: {} }

    } catch (err) {
      // err.inner — array of ValidationError for each failing field
      const errors = {}
      for (const error of err.inner ?? []) {
        if (!errors[error.path]) {
          errors[error.path] = { message: error.message }
        }
      }
      return { values: {}, errors }
    }
  }
}
```

### Writing a custom resolver

```js
// Example: custom resolver that calls an API to validate the entire form
function serverResolver(endpoint) {
  return async (values) => {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })

      if (response.ok) {
        return { values, errors: {} }
      }

      const { errors } = await response.json()
      // Expects: { errors: { fieldName: 'error message' } }
      return {
        values: {},
        errors: Object.fromEntries(
          Object.entries(errors).map(([k, v]) => [k, { message: v }])
        ),
      }
    } catch {
      return { values: {}, errors: { _form: { message: 'Network error' } } }
    }
  }
}

// Usage:
useForm({
  resolver: serverResolver('/api/validate/registration'),
  fields: { ... }
})
```

---

## 9. Full API Reference

### `useForm(options)`

```ts
interface UseFormOptions {
  // Field schema — keys are field names, values are rule objects
  fields?: Record<string, FieldSchema>

  // Override default values from schema
  // Priority: defaults[name] > schema[name].default > ''
  defaults?: Record<string, any>

  // When to run validation
  mode?: 'onSubmit' | 'onChange' | 'onBlur' | 'onTouched' | 'all'
  // Default: 'onSubmit'

  // External validator — replaces built-in rule engine
  resolver?: (values: Record<string, any>) => Promise<ResolverResult>
}

interface FieldSchema {
  default?: any             // Initial value
  required?: boolean | string
  minLength?: number | { value: number; message: string }
  maxLength?: number | { value: number; message: string }
  min?: number | { value: number; message: string }
  max?: number | { value: number; message: string }
  pattern?: { value: RegExp; message: string }
  validate?: ValidateFn | Record<string, ValidateFn>
}

type ValidateFn = (value: any) => boolean | string | Promise<boolean | string>
```

### Return value of `useForm()`

```ts
interface UseFormReturn {
  // Field descriptors — one per key in options.fields
  fields: Record<string, FieldDescriptor>

  // Readonly reactive meta-state
  formState: Readonly<{
    isSubmitting: boolean
    isSubmitted:  boolean
    submitCount:  number
    isValid:      boolean
    isDirty:      boolean
  }>

  // Submit handler wrapper
  handleSubmit: (
    onValid:    (values: Record<string, any>) => void | Promise<void>,
    onInvalid?: (errors: Record<string, any>) => void
  ) => (event?: Event) => Promise<void>

  // Reset to defaults
  reset: (newValues?: Record<string, any>) => void

  // Programmatic error management
  setError:    (name: string, message: string) => void
  clearErrors: (name?: string) => void

  // Programmatic value management
  setValue: (name: string, value: any) => void
  getValue: (name?: string) => any
}

interface FieldDescriptor {
  model:   WritableComputedRef<any>   // for v-model
  value:   any                         // plain getter
  error:   ComputedRef<string | null>  // current error or null
  touched: boolean                     // user has blurred the field
  dirty:   boolean                     // value differs from default
  attrs: {
    onBlur: () => void                 // for v-bind
  }
}
```

---

## 10. Complete Examples

### Login form

```vue
<!-- LoginForm.vue -->
<script setup>
import { useForm } from './useForm'

const emit = defineEmits(['success'])

const { fields, formState, handleSubmit } = useForm({
  mode: 'onBlur',
  fields: {
    email: {
      default: '',
      required: 'Email is required',
      pattern: {
        value: /^\S+@\S+\.\S+$/,
        message: 'Enter a valid email address',
      },
    },
    password: {
      default: '',
      required: 'Password is required',
      minLength: { value: 8, message: 'Password must be at least 8 characters' },
    },
  },
})

const onSubmit = handleSubmit(
  async (values) => {
    const user = await api.login(values)
    emit('success', user)
  },
  (errors) => {
    console.warn('Validation failed:', errors)
  }
)
</script>

<template>
  <form @submit.prevent="onSubmit" novalidate>

    <div class="field">
      <label for="email">Email</label>
      <input
        id="email"
        v-model="fields.email.model"
        v-bind="fields.email.attrs"
        type="email"
        autocomplete="email"
      />
      <p v-if="fields.email.error" class="error">
        {{ fields.email.error }}
      </p>
    </div>

    <div class="field">
      <label for="password">Password</label>
      <input
        id="password"
        v-model="fields.password.model"
        v-bind="fields.password.attrs"
        type="password"
        autocomplete="current-password"
      />
      <p v-if="fields.password.error" class="error">
        {{ fields.password.error }}
      </p>
    </div>

    <button type="submit" :disabled="formState.isSubmitting">
      {{ formState.isSubmitting ? 'Signing in...' : 'Sign In' }}
    </button>

  </form>
</template>
```

---

### Registration form with Zod

```vue
<!-- RegistrationForm.vue -->
<script setup>
import { z } from 'zod'
import { useForm, zodResolver } from './useForm'

const schema = z.object({
  username: z
    .string()
    .min(3, 'At least 3 characters')
    .max(20, 'Maximum 20 characters')
    .regex(/^[a-z0-9_]+$/, 'Only lowercase letters, numbers, underscores'),

  email: z
    .string()
    .min(1, 'Email is required')
    .email('Enter a valid email'),

  password: z
    .string()
    .min(8, 'At least 8 characters')
    .regex(/[A-Z]/, 'At least one uppercase letter')
    .regex(/[0-9]/, 'At least one number'),

  confirmPassword: z.string(),
}).refine(
  (data) => data.password === data.confirmPassword,
  { message: "Passwords don't match", path: ['confirmPassword'] }
)

const { fields, formState, handleSubmit, setError } = useForm({
  mode: 'onTouched',
  resolver: zodResolver(schema),
  fields: {
    username:        { default: '' },
    email:           { default: '' },
    password:        { default: '' },
    confirmPassword: { default: '' },
  },
})

const onSubmit = handleSubmit(async (values) => {
  try {
    await api.register(values)
    router.push('/welcome')
  } catch (err) {
    // Handle server-side errors
    if (err.field) setError(err.field, err.message)
  }
})
</script>

<template>
  <form @submit.prevent="onSubmit" novalidate>

    <label>Username
      <input v-model="fields.username.model" v-bind="fields.username.attrs" />
      <span class="error">{{ fields.username.error }}</span>
    </label>

    <label>Email
      <input v-model="fields.email.model" v-bind="fields.email.attrs" type="email" />
      <span class="error">{{ fields.email.error }}</span>
    </label>

    <label>Password
      <input v-model="fields.password.model" v-bind="fields.password.attrs" type="password" />
      <span class="error">{{ fields.password.error }}</span>
    </label>

    <label>Confirm Password
      <input v-model="fields.confirmPassword.model" v-bind="fields.confirmPassword.attrs" type="password" />
      <span class="error">{{ fields.confirmPassword.error }}</span>
    </label>

    <button type="submit" :disabled="formState.isSubmitting">
      {{ formState.isSubmitting ? 'Creating account...' : 'Create Account' }}
    </button>

  </form>
</template>
```

---

### Multi-step form

```vue
<!-- MultiStepForm.vue -->
<script setup>
import { ref } from 'vue'
import { useForm } from './useForm'

const step = ref(1)

const { fields, handleSubmit, getValue, formState } = useForm({
  mode: 'onChange',
  fields: {
    // Step 1 — Personal info
    firstName: { required: 'First name is required' },
    lastName:  { required: 'Last name is required' },
    birthDate: { required: 'Date of birth is required' },

    // Step 2 — Contact
    email: {
      required: 'Email is required',
      pattern: { value: /^\S+@\S+$/, message: 'Invalid email' },
    },
    phone: {
      pattern: { value: /^\+?[\d\s\-()]{10,}$/, message: 'Invalid phone number' },
    },

    // Step 3 — Account
    username: {
      required: 'Username is required',
      minLength: { value: 3, message: 'At least 3 characters' },
    },
    password: {
      required: 'Password is required',
      minLength: { value: 8, message: 'At least 8 characters' },
    },
  },
})

// Field groups per step — for per-step validation
const stepFields = {
  1: ['firstName', 'lastName', 'birthDate'],
  2: ['email', 'phone'],
  3: ['username', 'password'],
}

function nextStep() {
  // Only proceed if current step's fields are all valid
  const currentFields = stepFields[step.value]
  const allValid = currentFields.every(name => !fields[name].error && fields[name].value)
  if (allValid) step.value++
}

const onSubmit = handleSubmit(async (values) => {
  await api.createAccount(values)
  router.push('/dashboard')
})
</script>

<template>
  <div class="multi-step-form">
    <!-- Progress indicator -->
    <div class="steps">
      <span v-for="n in 3" :key="n" :class="{ active: step === n, done: step > n }">
        Step {{ n }}
      </span>
    </div>

    <form @submit.prevent="onSubmit" novalidate>

      <!-- Step 1: Personal Info -->
      <template v-if="step === 1">
        <h2>Personal Information</h2>
        <input v-model="fields.firstName.model" placeholder="First name" />
        <span class="error">{{ fields.firstName.error }}</span>

        <input v-model="fields.lastName.model" placeholder="Last name" />
        <span class="error">{{ fields.lastName.error }}</span>

        <input v-model="fields.birthDate.model" type="date" />
        <span class="error">{{ fields.birthDate.error }}</span>

        <button type="button" @click="nextStep">Next →</button>
      </template>

      <!-- Step 2: Contact -->
      <template v-else-if="step === 2">
        <h2>Contact Details</h2>
        <input v-model="fields.email.model" v-bind="fields.email.attrs" type="email" placeholder="Email" />
        <span class="error">{{ fields.email.error }}</span>

        <input v-model="fields.phone.model" v-bind="fields.phone.attrs" type="tel" placeholder="Phone (optional)" />
        <span class="error">{{ fields.phone.error }}</span>

        <button type="button" @click="step--">← Back</button>
        <button type="button" @click="nextStep">Next →</button>
      </template>

      <!-- Step 3: Account -->
      <template v-else>
        <h2>Create Your Account</h2>
        <input v-model="fields.username.model" v-bind="fields.username.attrs" placeholder="Username" />
        <span class="error">{{ fields.username.error }}</span>

        <input v-model="fields.password.model" v-bind="fields.password.attrs" type="password" placeholder="Password" />
        <span class="error">{{ fields.password.error }}</span>

        <button type="button" @click="step--">← Back</button>
        <button type="submit" :disabled="formState.isSubmitting">
          {{ formState.isSubmitting ? 'Creating...' : 'Create Account' }}
        </button>
      </template>

    </form>
  </div>
</template>
```

---

### Reusable form components with context

```vue
<!-- FormInput.vue — standalone input connected to nearest form -->
<script setup>
import { useField } from './useForm'

const props = defineProps({
  name:        { type: String, required: true },
  label:       String,
  type:        { type: String, default: 'text' },
  placeholder: String,
  hint:        String,    // helper text below input
})

const field = useField(props.name)
</script>

<template>
  <div class="form-group" :class="{
    'form-group--error':   !!field.error,
    'form-group--touched': field.touched,
    'form-group--dirty':   field.dirty,
  }">
    <label v-if="label" class="form-label">{{ label }}</label>

    <input
      v-model="field.model"
      v-bind="field.attrs"
      :type="type"
      :placeholder="placeholder"
      class="form-input"
      :class="{ 'form-input--error': field.touched && field.error }"
    />

    <p v-if="field.touched && field.error" class="form-error">
      {{ field.error }}
    </p>
    <p v-else-if="hint" class="form-hint">
      {{ hint }}
    </p>
  </div>
</template>
```

```vue
<!-- FormSelect.vue — works with any <select> or custom dropdown -->
<script setup>
import { useField } from './useForm'

const props = defineProps({
  name:    { type: String,   required: true },
  label:   String,
  options: { type: Array, required: true },  // [{ value, label }]
})

const field = useField(props.name)
</script>

<template>
  <div class="form-group">
    <label v-if="label" class="form-label">{{ label }}</label>
    <select v-model="field.model" v-bind="field.attrs" class="form-select">
      <option disabled value="">Select an option</option>
      <option v-for="opt in options" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>
    <p v-if="field.error" class="form-error">{{ field.error }}</p>
  </div>
</template>
```

```vue
<!-- ProfileForm.vue — uses both reusable components -->
<script setup>
import { useForm } from './useForm'
import FormInput  from './FormInput.vue'
import FormSelect from './FormSelect.vue'

const { handleSubmit, formState, reset } = useForm({
  mode: 'onTouched',
  fields: {
    firstName: { required: 'Required' },
    lastName:  { required: 'Required' },
    email:     { required: 'Required', pattern: { value: /^\S+@\S+$/, message: 'Invalid' } },
    country:   { required: 'Please select a country' },
    bio:       { maxLength: { value: 300, message: 'Maximum 300 characters' } },
  },
  defaults: {
    firstName: currentUser.firstName,
    lastName:  currentUser.lastName,
    email:     currentUser.email,
    country:   currentUser.country,
    bio:       currentUser.bio,
  }
})

const countries = [
  { value: 'ua', label: 'Ukraine' },
  { value: 'us', label: 'United States' },
  { value: 'gb', label: 'United Kingdom' },
]

const onSubmit = handleSubmit(async (values) => {
  await api.updateProfile(values)
  reset(values)  // new values become the new baseline
})
</script>

<template>
  <form @submit.prevent="onSubmit">
    <FormInput name="firstName" label="First Name" />
    <FormInput name="lastName"  label="Last Name" />
    <FormInput name="email"     label="Email" type="email" />
    <FormSelect name="country"  label="Country" :options="countries" />
    <FormInput
      name="bio"
      label="Bio"
      placeholder="Tell us about yourself..."
      hint="Maximum 300 characters"
    />

    <div class="form-actions">
      <button type="button" @click="reset()" :disabled="!formState.isDirty">
        Discard changes
      </button>
      <button type="submit" :disabled="formState.isSubmitting || !formState.isDirty">
        {{ formState.isSubmitting ? 'Saving...' : 'Save Profile' }}
      </button>
    </div>
  </form>
</template>
```

---

*useForm.js — Vue 3 Form Library. MIT License.*
