import './style.css'
import { db } from './firebase.js'
import {
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  setDoc,
  query,
  orderBy,
} from 'firebase/firestore'

// ── Firestore refs ───────────────────────────────────────
const tasksCol  = collection(db, 'tasks')
const inkopCol  = collection(db, 'inkop')
const receptCol = collection(db, 'recept')
const metaRef   = doc(db, 'meta', 'daily')   // ersätter DAILY_KEY i localStorage

// ── Helpers ──────────────────────────────────────────────
function todayStr() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm   = String(d.getMonth() + 1).padStart(2, '0')
  const dd   = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function isWeekday(dateStr) {
  const day = new Date(dateStr + 'T12:00:00').getDay()
  return day >= 1 && day <= 5
}

function formatDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('sv-SE', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}

function escapeHtml(str) {
  const d = document.createElement('div')
  d.textContent = str
  return d.innerHTML
}

// ── Dagliga uppgifter ────────────────────────────────────
const DAILY_TASKS = [
  'Sök ett nytt jobb',
  '1 minut plankan',
  '1 minut jägarställning',
  '15 armhävningar',
]

async function maybeCreateDailyTasks(currentTasks) {
  const today = todayStr()
  if (!isWeekday(today)) return

  const snap = await getDoc(metaRef)
  if (snap.exists() && snap.data().lastDailyDate === today) return

  for (const title of DAILY_TASKS) {
    const alreadyExists = currentTasks.some(
      t => t.daily && t.date === today && t.title === title
    )
    if (!alreadyExists) {
      await addDoc(tasksCol, {
        title,
        date:      today,
        started:   false,
        done:      false,
        daily:     true,
        createdAt: Date.now(),
      })
    }
  }

  await setDoc(metaRef, { lastDailyDate: today })
}

// ── Status ───────────────────────────────────────────────
function getStatus(task) {
  if (task.done)              return 'done'
  if (task.date < todayStr()) return 'delayed'
  if (task.started)           return 'started'
  return 'pending'
}

const STATUS_LABEL = {
  pending: 'Ej påbörjad',
  started: 'Påbörjad',
  delayed: 'Försenad',
  done:    'Klar',
}

// ── Render ───────────────────────────────────────────────
let tasks = []

function buildCard(task) {
  const status = getStatus(task)
  const card = document.createElement('div')
  card.className =
    'task-card' +
    (task.done ? ' is-done' : '') +
    (status === 'delayed' ? ' is-overdue' : '')
  card.dataset.id = task.id

  card.innerHTML = `
    <div class="status-pill s-${status}">
      <div class="status-dot"></div>
      ${STATUS_LABEL[status]}
    </div>
    <div class="task-body">
      <div class="task-title">${escapeHtml(task.title)}</div>
      <div class="task-date">${formatDate(task.date)}</div>
    </div>
    <div class="task-actions">
      <label class="cb-label">
        <input type="checkbox" data-action="started" data-id="${task.id}"${task.started ? ' checked' : ''}>
        Påbörjad
      </label>
      <label class="cb-label">
        <input type="checkbox" data-action="done" data-id="${task.id}"${task.done ? ' checked' : ''}>
        Klar
      </label>
      <button class="delete-btn" data-action="delete" data-id="${task.id}" title="Radera uppgift" aria-label="Radera">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <line x1="2" y1="2" x2="12" y2="12"/><line x1="12" y1="2" x2="2" y2="12"/>
        </svg>
      </button>
    </div>
  `
  return card
}

function render() {
  const todoList = document.getElementById('todo-list')
  const doneList = document.getElementById('done-list')

  const todo = tasks.filter(t => !t.done)
  const done = tasks.filter(t =>  t.done)

  document.getElementById('count-todo').textContent = todo.length
  document.getElementById('count-done').textContent = done.length

  todoList.innerHTML = ''
  if (todo.length === 0) {
    todoList.innerHTML = `
      <div class="empty-state">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
        </svg>
        Inga uppgifter kvar — bra jobbat!
      </div>`
  } else {
    todo.forEach(t => todoList.appendChild(buildCard(t)))
  }

  doneList.innerHTML = ''
  if (done.length === 0) {
    doneList.innerHTML = `
      <div class="empty-state">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
        </svg>
        Inga genomförda uppgifter ännu.
      </div>`
  } else {
    done.forEach(t => doneList.appendChild(buildCard(t)))
  }
}

// ── Firestore realtidslyssnare ───────────────────────────
// Ersätter load() + save(). Varje ändring i Firestore
// triggar denna callback, som uppdaterar tasks och renderar om.
let dailyInitialized = false

onSnapshot(
  query(tasksCol, orderBy('createdAt')),
  snapshot => {
    tasks = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
    render()

    // Kör daglig uppgiftsskapning en gång vid första snapshot,
    // så att vi har den aktuella uppgiftslistan att kontrollera mot.
    if (!dailyInitialized) {
      dailyInitialized = true
      maybeCreateDailyTasks(tasks)
    }
  },
  err => console.error('Firestore-lyssnare fel:', err)
)

// ── Händelser — kryssrutor ───────────────────────────────
document.addEventListener('change', async e => {
  const { action, id } = e.target.dataset
  if (!action || !id) return

  const taskRef = doc(db, 'tasks', id)

  if (action === 'started') {
    await updateDoc(taskRef, { started: e.target.checked })
  } else if (action === 'done') {
    await updateDoc(taskRef, { done: e.target.checked })
  }
  // onSnapshot renderar om automatiskt efter updateDoc.
})

// ── Händelser — radera ───────────────────────────────────
document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-action="delete"]')
  if (!btn) return
  await deleteDoc(doc(db, 'tasks', btn.dataset.id))
})

// ── Inköpslista ──────────────────────────────────────────
let inkopItems = []

function renderInkop() {
  const list = document.getElementById('inkop-list')
  document.getElementById('count-inkop').textContent = inkopItems.length

  list.innerHTML = ''
  if (inkopItems.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/>
          <path d="M16 10a4 4 0 01-8 0"/>
        </svg>
        Inköpslistan är tom.
      </div>`
    return
  }

  inkopItems.forEach(item => {
    const row = document.createElement('div')
    row.className = 'inkop-item'
    row.innerHTML = `
      <label class="inkop-label">
        <input type="checkbox" data-action="inkop-check" data-id="${item.id}">
        <span>${escapeHtml(item.name)}</span>
      </label>`
    list.appendChild(row)
  })
}

onSnapshot(
  query(inkopCol, orderBy('createdAt')),
  snapshot => {
    inkopItems = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
    renderInkop()
  },
  err => console.error('Inkop-lyssnare fel:', err)
)

document.getElementById('inkop-form').addEventListener('submit', async e => {
  e.preventDefault()
  const input = document.getElementById('inkop-input')
  const name = input.value.trim()
  if (!name) return
  await addDoc(inkopCol, { name, createdAt: Date.now() })
  input.value = ''
  input.focus()
})

document.addEventListener('change', async e => {
  if (e.target.dataset.action !== 'inkop-check') return
  await deleteDoc(doc(db, 'inkop', e.target.dataset.id))
})

// ── Extrahera råvara ur ingredienssträng ─────────────────
function extractIngredientName(raw) {
  let s = raw.trim()

  // Ta bort "ca" i början
  s = s.replace(/^ca\.?\s+/i, '')

  // Ta bort inledande siffror, bråktal och unicode-bråk
  s = s.replace(/^[\d\s,.½¼¾⅓⅔⅛⅜⅝⅞\-\/]+/, '').trim()

  // Ta bort enhet som står kvar i början
  const units = [
    'msk', 'tsk', 'krm', 'förp', 'dl', 'cl', 'ml',
    'kg', 'hg', 'mg', 'g', 'liter', 'l', 'st', 'oz', 'lb',
    'paket', 'burk', 'pkt', 'ask', 'portioner', 'portion', 'näve', 'nypor', 'nypa',
  ]
  for (const unit of units) {
    const re = new RegExp(`^${unit}\\.?\\s+`, 'i')
    s = s.replace(re, '').trim()
  }

  // Ta bort tillagningsnotes efter komma, t.ex. "lök, hackad"
  s = s.replace(/,.*$/, '').trim()

  // Ta bort parenteser, t.ex. "mjöl (vetemjöl)"
  s = s.replace(/\(.*?\)/g, '').trim()

  // Rensa sammansatta form-ord i slutet av ordet
  // t.ex. "vitlöksklyftor" → vitlök (ta bort "klyftor", sedan genitiv-s)
  const formWords = [
    'klyftor', 'klyfta', 'skivor', 'skiva', 'bitar', 'bit',
    'strimlor', 'strimla', 'knippen', 'knippe', 'kvistar', 'kvist',
    'bullar', 'bulle', 'kärnor', 'kärna', 'blad', 'stilkar', 'stilk',
    'skivor', 'lock', 'stockar', 'stock', 'huvuden', 'huvud',
  ]
  const lower = s.toLowerCase()
  for (const form of formWords) {
    if (lower.endsWith(form)) {
      const stripped = s.slice(0, s.length - form.length).replace(/s$/i, '')
      if (stripped.trim().length >= 3) { s = stripped.trim(); break }
    }
  }

  // Ta bort ledande tillagningsadjektiv om det finns ett ord kvar
  const adjectives = [
    'färsk', 'färska', 'fryst', 'frysta', 'hackad', 'hackade',
    'skivad', 'skivade', 'riven', 'rivna', 'pressad', 'pressade',
    'tärnad', 'tärnade', 'mald', 'malen', 'strimlad', 'strimlade',
    'kokt', 'kokta', 'stekt', 'stekta', 'grovhackad', 'finhackad',
  ]
  const words = s.split(/\s+/)
  if (words.length > 1 && adjectives.includes(words[0].toLowerCase())) {
    s = words.slice(1).join(' ')
  }
  if (words.length > 1 && adjectives.includes(words[words.length - 1].toLowerCase())) {
    s = words.slice(0, -1).join(' ')
  }

  return s.trim() || raw.trim()
}

// ── Recept ───────────────────────────────────────────────
let receptItems = []
let activeRecept = null

function findRecipeInData(data) {
  if (!data) return null
  if (Array.isArray(data)) {
    for (const item of data) {
      const r = findRecipeInData(item)
      if (r) return r
    }
    return null
  }
  if (typeof data !== 'object') return null
  const types = [].concat(data['@type'] || [])
  if (types.some(t => t === 'Recipe' || String(t).endsWith('/Recipe'))) {
    const img = data.image
    const rawImg = Array.isArray(img) ? img[0] : img
    const imageUrl = typeof rawImg === 'string' ? rawImg : rawImg?.url || ''
    return {
      title: data.name || '',
      image: imageUrl,
      ingredients: [].concat(data.recipeIngredient || []).filter(Boolean),
      instructions: [].concat(data.recipeInstructions || [])
        .map(i => typeof i === 'string' ? i : i.text || i.name || '')
        .filter(Boolean),
    }
  }
  if (data['@graph']) return findRecipeInData(data['@graph'])
  // Rekursivt genom alla värden för djupt nästlade strukturer
  for (const val of Object.values(data)) {
    if (val && typeof val === 'object') {
      const r = findRecipeInData(val)
      if (r) return r
    }
  }
  return null
}

function tryParseJsonLd(raw) {
  try { return JSON.parse(raw) } catch {}
  // Försök avkoda HTML-entiteter innan parse
  const el = document.createElement('textarea')
  el.innerHTML = raw
  try { return JSON.parse(el.value) } catch {}
  return null
}

async function fetchRecipeData(url) {
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
  ]

  let html = ''
  for (const proxy of proxies) {
    try {
      const res = await fetch(proxy, { signal: AbortSignal.timeout(12000) })
      if (res.ok) {
        const text = await res.text()
        if (text.length > 200) { html = text; break }
      }
    } catch {}
  }

  if (!html) return { title: url, image: '', ingredients: [], instructions: [] }

  const doc2 = new DOMParser().parseFromString(html, 'text/html')
  const pageTitle = doc2.querySelector('title')?.textContent?.trim() || url

  // Försök 1: DOMParser-noder
  for (const script of doc2.querySelectorAll('script[type="application/ld+json"]')) {
    for (const raw of [script.textContent, script.innerHTML]) {
      const data = tryParseJsonLd(raw)
      if (!data) continue
      const recipe = findRecipeInData(data)
      if (recipe) return { ...recipe, title: recipe.title || pageTitle }
    }
  }

  // Försök 2: regex direkt på rå HTML (om DOMParser tappade script-innehåll)
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const data = tryParseJsonLd(m[1])
    if (!data) continue
    const recipe = findRecipeInData(data)
    if (recipe) return { ...recipe, title: recipe.title || pageTitle }
  }

  return { title: pageTitle, image: '', ingredients: [], instructions: [] }
}

function renderRecept() {
  const list = document.getElementById('recept-list')
  document.getElementById('count-recept').textContent = receptItems.length
  list.innerHTML = ''

  if (receptItems.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
          <rect x="9" y="3" width="6" height="4" rx="1"/>
          <path d="M9 12h6M9 16h4"/>
        </svg>
        Inga recept sparade än.
      </div>`
    return
  }

  receptItems.forEach(r => {
    const card = document.createElement('div')
    card.className = 'recept-card'
    card.innerHTML = `
      ${r.image ? `<img class="recept-card-img" src="${escapeHtml(r.image)}" alt="">` : '<div class="recept-card-placeholder"></div>'}
      <div class="recept-card-body">
        <div class="recept-card-title">${escapeHtml(r.title)}</div>
        <a class="recept-card-link" href="${escapeHtml(r.url)}" target="_blank" rel="noopener">Öppna källa ↗</a>
      </div>
      <button class="delete-btn" data-action="delete-recept" data-id="${r.id}" title="Radera recept">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <line x1="2" y1="2" x2="12" y2="12"/><line x1="12" y1="2" x2="2" y2="12"/>
        </svg>
      </button>`
    card.addEventListener('click', e => {
      if (e.target.closest('[data-action="delete-recept"]') || e.target.closest('a')) return
      showReceptDetail(r)
    })
    list.appendChild(card)
  })
}

function showReceptDetail(recept) {
  activeRecept = recept
  const detail   = document.getElementById('recept-detail')
  const list     = document.getElementById('recept-list')
  const form     = document.getElementById('recept-form')

  const ingredientsHtml = recept.ingredients.length
    ? recept.ingredients.map(ing => `<li class="recept-ingredient" data-name="${escapeHtml(ing)}">${escapeHtml(ing)}</li>`).join('')
    : '<li class="recept-no-data">Inga ingredienser hittades</li>'

  const instructionsHtml = recept.instructions.length
    ? recept.instructions.map((step, i) => `
        <li class="recept-step"><span class="step-num">${i + 1}</span>${escapeHtml(step)}</li>`).join('')
    : '<li class="recept-no-data">Inga instruktioner hittades</li>'

  detail.innerHTML = `
    <button class="recept-back-btn" id="recept-back">← Alla recept</button>
    ${recept.image ? `<img class="recept-hero" src="${escapeHtml(recept.image)}" alt="">` : ''}
    <h2 class="recept-title">${escapeHtml(recept.title)}</h2>
    <a class="recept-source-link" href="${escapeHtml(recept.url)}" target="_blank" rel="noopener">Öppna originalkälla ↗</a>
    <h3 class="recept-section-heading">Ingredienser <span class="recept-hint">— klicka för att lägga till i inköpslistan</span></h3>
    <ul class="recept-ingredients">${ingredientsHtml}</ul>
    <h3 class="recept-section-heading">Instruktioner</h3>
    <ol class="recept-instructions">${instructionsHtml}</ol>`

  detail.classList.remove('recept-hidden')
  list.classList.add('recept-hidden')
  form.classList.add('recept-hidden')

  document.getElementById('recept-back').addEventListener('click', () => {
    detail.classList.add('recept-hidden')
    list.classList.remove('recept-hidden')
    form.classList.remove('recept-hidden')
    activeRecept = null
  })

  detail.querySelectorAll('.recept-ingredient').forEach(el => {
    el.addEventListener('click', async () => {
      const cleaned = extractIngredientName(el.dataset.name)
      if (confirm(`Lägg till "${cleaned}" i inköpslistan?`)) {
        await addDoc(inkopCol, { name: cleaned, createdAt: Date.now() })
      }
    })
  })
}

onSnapshot(
  query(receptCol, orderBy('createdAt', 'desc')),
  snapshot => {
    receptItems = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
    if (!activeRecept) renderRecept()
  },
  err => console.error('Recept-lyssnare fel:', err)
)

document.getElementById('recept-form').addEventListener('submit', async e => {
  e.preventDefault()
  const input   = document.getElementById('recept-url')
  const loading = document.getElementById('recept-loading')
  const url = input.value.trim()
  if (!url) return

  loading.classList.remove('recept-hidden')
  input.disabled = true

  try {
    const data = await fetchRecipeData(url)
    await addDoc(receptCol, { url, ...data, createdAt: Date.now() })
    input.value = ''
  } catch {
    await addDoc(receptCol, { url, title: url, image: '', ingredients: [], instructions: [], createdAt: Date.now() })
    input.value = ''
  } finally {
    loading.classList.add('recept-hidden')
    input.disabled = false
    input.focus()
  }
})

document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-action="delete-recept"]')
  if (!btn) return
  e.stopPropagation()
  if (activeRecept?.id === btn.dataset.id) {
    document.getElementById('recept-detail').classList.add('recept-hidden')
    document.getElementById('recept-list').classList.remove('recept-hidden')
    document.getElementById('recept-form').classList.remove('recept-hidden')
    activeRecept = null
  }
  await deleteDoc(doc(db, 'recept', btn.dataset.id))
})

// ── Flikar ───────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
    btn.classList.add('active')
    document.getElementById('panel-' + btn.dataset.tab).classList.add('active')
  })
})

// ── Lägg till-formulär ───────────────────────────────────
const dateInput  = document.getElementById('task-date')
const titleInput = document.getElementById('task-title')

dateInput.value = todayStr()

document.getElementById('add-form').addEventListener('submit', async e => {
  e.preventDefault()
  const title = titleInput.value.trim()
  if (!title) return

  await addDoc(tasksCol, {
    title,
    date:      dateInput.value || todayStr(),
    started:   false,
    done:      false,
    daily:     false,
    createdAt: Date.now(),
  })

  titleInput.value = ''
  dateInput.value  = todayStr()
  titleInput.focus()
})
