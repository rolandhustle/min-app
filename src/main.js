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
