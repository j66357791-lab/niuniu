<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSocket } from '../composables/useSocket'
import { useUserStore } from '../stores/user'
import { showToast } from '../composables/useToast'

const router = useRouter()
const { getSocket, connected } = useSocket()
const userStore = useUserStore()

const showCreateModal = ref(false)
const createPassword = ref('')
const createMaxPlayers = ref('4')
const createBaseScore = ref('10')
const createError = ref('')

const showJoinModal = ref(false)
const joinRoomId = ref('')
const joinPassword = ref('')
const joinError = ref('')

const submitting = ref(false)

// 【新增】：积分刷新状态与逻辑
const isRefreshingScore = ref(false)
async function refreshMyScore() {
  if (isRefreshingScore.value) return
  isRefreshingScore.value = true
  try {
    const token = localStorage.getItem('token')
    if (!token) { showToast('请先登录', 'error'); return }
    const res = await fetch('/api/user/score', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    const data = await res.json()
    if (data.ok) {
      userStore.updateScore(data.score)
      showToast('积分已刷新', 'success')
    } else {
      showToast(data.msg || '刷新失败', 'error')
    }
  } catch (err) {
    showToast('网络异常', 'error')
  } finally {
    setTimeout(() => { isRefreshingScore.value = false }, 1000)
  }
}

function openCreate() { createPassword.value = ''; createMaxPlayers.value = '4'; createBaseScore.value = '10'; createError.value = ''; showCreateModal.value = true }
function openJoin() { joinRoomId.value = ''; joinPassword.value = ''; joinError.value = ''; showJoinModal.value = true }
function closeModals() { showCreateModal.value = false; showJoinModal.value = false }

function confirmCreate() {
  const pwd = createPassword.value.trim()
  if (!pwd) { createError.value = '请输入房间密码'; return }
  if (pwd.length < 4) { createError.value = '密码至少4位'; return }

  const sock = getSocket()
  if (!sock?.connected) { createError.value = '连接异常'; return }
  submitting.value = true; createError.value = ''

  sock.emit('create_room', { password: pwd, maxPlayers: createMaxPlayers.value, baseScore: createBaseScore.value }, (res) => {
    submitting.value = false
    if (res.ok) { showCreateModal.value = false; router.push(`/room/${res.roomId}`) }
    else createError.value = res.msg || '创建失败'
  })
}

function confirmJoin() {
  const rid = joinRoomId.value.trim(), pwd = joinPassword.value.trim()
  if (!rid || !/^\d{4}$/.test(rid)) { joinError.value = '请输入正确的4位房间号'; return }
  if (!pwd) { joinError.value = '请输入房间密码'; return }

  const sock = getSocket()
  if (!sock?.connected) { joinError.value = '连接异常'; return }
  submitting.value = true; joinError.value = ''

  sock.emit('join_room', { roomId: rid, password: pwd }, (res) => {
    submitting.value = false
    if (res.ok) { showJoinModal.value = false; router.push(`/room/${rid}`) }
    else joinError.value = res.msg || '加入失败'
  })
}

function goBack() { router.push('/home') }
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header class="card-panel border-t-0 border-x-0 rounded-none px-6 py-3 flex items-center gap-4">
      <button @click="goBack" class="text-muted hover:text-ivory transition-colors cursor-pointer bg-transparent border-none text-lg">←</button>
      <h1 class="text-ivory font-semibold">斗牛大厅</h1>
      <span class="text-xs ml-2" :class="connected ? 'text-btn-green' : 'text-btn-red'">{{ connected ? '● 已连接' : '● 未连接' }}</span>
      
      <!-- 【新增】：大厅积分手动刷新按钮 -->
      <div class="ml-auto flex items-center gap-1.5 text-xs text-muted">
        <span>积分: <span class="text-gold font-bold">{{ userStore.score ?? 0 }}</span></span>
        <button @click="refreshMyScore" :disabled="isRefreshingScore" class="text-muted hover:text-gold transition-colors cursor-pointer bg-transparent border-none p-0 disabled:opacity-50" title="刷新积分">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{'animate-spin': isRefreshingScore}"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
        </button>
      </div>
    </header>

    <main class="flex-1 flex items-center justify-center p-6">
      <div class="w-full max-w-md space-y-4">
        <button @click="openCreate" class="card-panel w-full p-6 text-left hover:border-gold/40 transition-colors duration-200 cursor-pointer group">
          <div class="flex items-center gap-4">
            <div class="w-14 h-14 rounded-xl bg-table-felt flex items-center justify-center shrink-0 group-hover:bg-btn-green transition-colors duration-200"><span class="text-gold-light text-xl font-bold">创</span></div>
            <div><h2 class="text-ivory font-semibold text-lg">创建房间</h2><p class="text-sm text-muted mt-0.5">自定义人数与底分</p></div>
          </div>
        </button>

        <button @click="openJoin" class="card-panel w-full p-6 text-left hover:border-gold/40 transition-colors duration-200 cursor-pointer group">
          <div class="flex items-center gap-4">
            <div class="w-14 h-14 rounded-xl bg-table-panel border border-table-border flex items-center justify-center shrink-0 group-hover:border-gold/40 transition-colors duration-200"><span class="text-muted text-xl font-bold group-hover:text-gold transition-colors duration-200">加</span></div>
            <div><h2 class="text-ivory font-semibold text-lg">加入房间</h2><p class="text-sm text-muted mt-0.5">输入房间号，快速加入</p></div>
          </div>
        </button>
      </div>
    </main>

    <Teleport to="body">
      <div v-if="showCreateModal" class="modal-overlay" @click.self="closeModals">
        <div class="modal-box">
          <h3 class="text-ivory font-semibold text-lg mb-5">创建房间</h3>
          <div class="space-y-4">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-sm text-muted mb-1.5">人数上限</label>
                <select v-model="createMaxPlayers" class="input-base text-sm"><option v-for="n in 11" :key="n" :value="n+1">{{ n+1 }}人</option></select>
              </div>
              <div>
                <label class="block text-sm text-muted mb-1.5">底分档位</label>
                <select v-model="createBaseScore" class="input-base text-sm"><option value="10">10分</option><option value="30">30分</option><option value="50">50分</option><option value="100">100分</option></select>
              </div>
            </div>
            <div><label class="block text-sm text-muted mb-1.5">房间密码</label><input v-model="createPassword" type="password" class="input-base" placeholder="设置房间密码" @keyup.enter="confirmCreate" /></div>
            <p v-if="createError" class="text-sm text-btn-red">{{ createError }}</p>
            <div class="flex gap-3 pt-2">
              <button @click="closeModals" class="btn-outline">取消</button>
              <button @click="confirmCreate" class="btn-primary flex items-center justify-center gap-2" :disabled="submitting"><span v-if="submitting" class="w-4 h-4 border-2 border-ivory/30 border-t-ivory rounded-full animate-spin"></span>确定创建</button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showJoinModal" class="modal-overlay" @click.self="closeModals">
        <div class="modal-box">
          <h3 class="text-ivory font-semibold text-lg mb-5">加入房间</h3>
          <div class="space-y-4">
            <div><label class="block text-sm text-muted mb-1.5">房间号</label><input v-model="joinRoomId" type="text" class="input-base" placeholder="请输入4位房间号" maxlength="4" @keyup.enter="confirmJoin" /></div>
            <div><label class="block text-sm text-muted mb-1.5">房间密码</label><input v-model="joinPassword" type="password" class="input-base" placeholder="请输入房间密码" @keyup.enter="confirmJoin" /></div>
            <p v-if="joinError" class="text-sm text-btn-red">{{ joinError }}</p>
            <div class="flex gap-3 pt-2">
              <button @click="closeModals" class="btn-outline">取消</button>
              <button @click="confirmJoin" class="btn-primary flex items-center justify-center gap-2" :disabled="submitting"><span v-if="submitting" class="w-4 h-4 border-2 border-ivory/30 border-t-ivory rounded-full animate-spin"></span>确定加入</button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
