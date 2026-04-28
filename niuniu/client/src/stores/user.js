import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUserStore = defineStore('user', () => {
  const saved = localStorage.getItem('niuniu_user')
  const parsed = saved ? JSON.parse(saved) : null

  const id = ref(parsed?.id || '')
  const username = ref(parsed?.username || '')
  const phone = ref(parsed?.phone || '')
  const role = ref(parsed?.role || 'user')
  const score = ref(parsed?.score ?? 0)
  const roomId = ref('')
  const isLoggedIn = ref(!!parsed)

  function login(userData) {
    id.value = userData.id
    username.value = userData.username
    phone.value = userData.phone || ''
    role.value = userData.role || 'user'
    score.value = userData.score ?? 0
    isLoggedIn.value = true
    persist()
  }

  function logout() {
    id.value = ''
    username.value = ''
    phone.value = ''
    role.value = 'user'
    score.value = 0
    roomId.value = ''
    isLoggedIn.value = false
    localStorage.removeItem('niuniu_user')
  }

  function updateScore(newScore) {
    score.value = newScore
    persist()
  }

  function setRoomId(rid) {
    roomId.value = rid
  }

  function persist() {
    localStorage.setItem('niuniu_user', JSON.stringify({
      id: id.value,
      username: username.value,
      phone: phone.value,
      role: role.value,
      score: score.value
    }))
  }

  return { id, username, phone, role, score, roomId, isLoggedIn, login, logout, updateScore, setRoomId }
})
