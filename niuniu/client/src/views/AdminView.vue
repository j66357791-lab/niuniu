<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import { showToast } from '../composables/useToast'

const router = useRouter()
const userStore = useUserStore()

const tab = ref('users')
const users = ref([])
const auditData = ref({ totalScore: 0, totalTx: 0, diff: 0 })

// 调整积分弹窗
const showAdjust = ref(false)
const adjustTarget = ref(null)
const adjustAmount = ref('')
const adjustReason = ref('')
const adjustSubmitting = ref(false)

function openAdjust(user) {
  adjustTarget.value = user
  adjustAmount.value = ''
  adjustReason.value = ''
  showAdjust.value = true
}

async function fetchUsers() {
  try {
    const res = await fetch(`/api/admin/users?adminUserId=${userStore.id}`)
    const data = await res.json()
    if (data.ok) users.value = data.data
  } catch {}
}

async function toggleBan(user) {
  try {
    const res = await fetch(`/api/admin/users/${user._id}/ban`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminUserId: userStore.id })
    })
    const data = await res.json()
    if (data.ok) { showToast(data.msg, 'success'); fetchUsers() }
    else showToast(data.msg, 'error')
  } catch { showToast('操作失败', 'error') }
}

async function handleAdjust() {
  const num = parseInt(adjustAmount.value)
  if (!num || !Number.isInteger(num)) { showToast('数额必须为整数', 'error'); return }
  if (!adjustReason.value.trim()) { showToast('请填写调整原因', 'error'); return }
  
  adjustSubmitting.value = true
  try {
    const res = await fetch(`/api/admin/users/${adjustTarget.value._id}/adjust-score`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminUserId: userStore.id, amount: num, reason: adjustReason.value.trim() })
    })
    const data = await res.json()
    if (data.ok) { showToast('调整成功', 'success'); showAdjust.value = false; fetchUsers() }
    else showToast(data.msg, 'error')
  } catch { showToast('操作失败', 'error') }
  finally { adjustSubmitting.value = false }
}

async function fetchAudit() {
  try {
    const res = await fetch(`/api/admin/audit?adminUserId=${userStore.id}`)
    const data = await res.json()
    if (data.ok) auditData.value = data.data
  } catch {}
}

function formatDate(d) {
  if (!d) return ''
  const date = new Date(d)
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`
}

onMounted(() => {
  fetchUsers()
  if (tab.value === 'audit') fetchAudit()
})

// 切换 tab 时加载数据
import { watch } from 'vue'
watch(tab, (v) => { if (v === 'users') fetchUsers(); if (v === 'audit') fetchAudit() })
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header class="card-panel border-t-0 border-x-0 rounded-none px-6 py-3 flex items-center gap-4">
      <button @click="router.push('/home')" class="text-muted hover:text-ivory transition-colors cursor-pointer bg-transparent border-none text-lg">←</button>
      <h1 class="text-ivory font-semibold">管理后台</h1>
      <span class="text-xs text-gold bg-gold/10 px-2 py-0.5 rounded">ADMIN</span>
    </header>

    <main class="flex-1 p-6 max-w-5xl mx-auto w-full">
      <!-- Tab 导航 -->
      <div class="flex gap-2 mb-6">
        <button @click="tab = 'users'"
          class="px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer border-none"
          :class="tab === 'users' ? 'bg-gold text-table-bg' : 'bg-table-bg text-muted hover:text-ivory'">
          用户管理
        </button>
        <button @click="tab = 'audit'"
          class="px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer border-none"
          :class="tab === 'audit' ? 'bg-gold text-table-bg' : 'bg-table-bg text-muted hover:text-ivory'">
          全局审计
        </button>
      </div>

      <!-- 用户管理 -->
      <div v-if="tab === 'users'" class="card-panel overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-table-bg text-muted text-xs uppercase">
              <tr>
                <th class="px-4 py-3 text-left">用户名</th>
                <th class="px-4 py-3 text-left">手机号</th>
                <th class="px-4 py-3 text-right">积分</th>
                <th class="px-4 py-3 text-center">状态</th>
                <th class="px-4 py-3 text-center">角色</th>
                <th class="px-4 py-3 text-left">注册时间</th>
                <th class="px-4 py-3 text-center">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-table-border">
              <tr v-for="u in users" :key="u._id" class="hover:bg-table-hover transition-colors">
                <td class="px-4 py-3 text-ivory font-medium">{{ u.username }}</td>
                <td class="px-4 py-3 text-muted font-mono text-xs">{{ u.phone || '-' }}</td>
                <td class="px-4 py-3 text-right text-gold font-mono">{{ u.score.toLocaleString() }}</td>
                <td class="px-4 py-3 text-center">
                  <span class="text-xs px-2 py-0.5 rounded"
                        :class="u.status === 'banned' ? 'bg-btn-red/20 text-btn-red' : 'bg-btn-green/20 text-btn-green'">
                    {{ u.status === 'banned' ? '封禁' : '正常' }}
                  </span>
                </td>
                <td class="px-4 py-3 text-center text-xs text-muted">{{ u.role }}</td>
                <td class="px-4 py-3 text-muted text-xs">{{ formatDate(u.createdAt) }}</td>
                <td class="px-4 py-3 text-center space-x-2">
                  <button @click="openAdjust(u)"
                    class="text-xs text-gold hover:text-gold-light cursor-pointer bg-transparent border-none">
                    调整积分
                  </button>
                  <button v-if="u.role !== 'admin'" @click="toggleBan(u)"
                    class="text-xs cursor-pointer bg-transparent border-none"
                    :class="u.status === 'banned' ? 'text-btn-green hover:text-green-300' : 'text-btn-red hover:text-red-300'">
                    {{ u.status === 'banned' ? '解封' : '封禁' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 全局审计 -->
      <div v-if="tab === 'audit'" class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="card-panel p-6 text-center">
          <p class="text-xs text-muted mb-2">系统实际总资产 (用户积分总和)</p>
          <p class="text-2xl font-bold text-gold font-mono">{{ auditData.totalScore.toLocaleString() }}</p>
        </div>
        <div class="card-panel p-6 text-center">
          <p class="text-xs text-muted mb-2">流水净增减 (账单 amount 总和)</p>
          <p class="text-2xl font-bold text-gold font-mono">{{ auditData.totalTx.toLocaleString() }}</p>
        </div>
        <div class="card-panel p-6 text-center">
          <p class="text-xs text-muted mb-2">差值 (应为 0)</p>
          <p class="text-2xl font-bold font-mono"
             :class="auditData.diff === 0 ? 'text-btn-green' : 'text-btn-red animate-pulse'">
            {{ auditData.diff === 0 ? '0 (安全)' : auditData.diff }}
          </p>
        </div>
      </div>
    </main>

    <!-- 积分调整弹窗 -->
    <Teleport to="body">
      <div v-if="showAdjust" class="modal-overlay" @click.self="showAdjust = false">
        <div class="modal-box">
          <h3 class="text-ivory font-semibold text-lg mb-1">调整积分</h3>
          <p class="text-xs text-muted mb-5">目标用户：{{ adjustTarget?.username }} (当前: {{ adjustTarget?.score }})</p>
          <div class="space-y-4">
            <div>
              <label class="block text-sm text-muted mb-1.5">调整数额 (正数增加，负数扣减)</label>
              <input v-model="adjustAmount" type="number" class="input-base" placeholder="如 100 或 -50" />
            </div>
            <div>
              <label class="block text-sm text-muted mb-1.5">调整原因 (必填)</label>
              <input v-model="adjustReason" type="text" class="input-base" placeholder="如：活动补偿" />
            </div>
            <div class="flex gap-3 pt-2">
              <button @click="showAdjust = false" class="btn-outline">取消</button>
              <button @click="handleAdjust" class="btn-primary flex items-center justify-center gap-2" :disabled="adjustSubmitting">
                <span v-if="adjustSubmitting" class="w-4 h-4 border-2 border-ivory/30 border-t-ivory rounded-full animate-spin"></span>
                确认调整
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
