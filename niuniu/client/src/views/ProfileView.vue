<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import { showToast } from '../composables/useToast'

const router = useRouter()
const userStore = useUserStore()

const toUsername = ref('')
const amount = ref('')
const submitting = ref(false)
const transactions = ref([])

async function handleTransfer() {
  const name = toUsername.value.trim()
  const num = parseInt(amount.value)
  if (!name) { showToast('请输入目标用户名', 'error'); return }
  if (!num || num <= 0 || !Number.isInteger(num)) { showToast('请输入正确的正整数积分', 'error'); return }

  submitting.value = true
  try {
    const res = await fetch('/api/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromUserId: userStore.id, toUsername: name, amount: num })
    })
    const data = await res.json()
    if (!data.ok) { showToast(data.msg, 'error'); return }
    showToast('转增成功', 'success')
    userStore.updateScore(data.data.newScore)
    toUsername.value = ''; amount.value = ''
    fetchTransactions()
  } catch { showToast('网络异常', 'error') }
  finally { submitting.value = false }
}

async function fetchTransactions() {
  try {
    const res = await fetch(`/api/transactions?userId=${userStore.id}`)
    const data = await res.json()
    if (data.ok) transactions.value = data.data
  } catch {}
}

function formatTime(dateStr) {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

onMounted(fetchTransactions)
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header class="card-panel border-t-0 border-x-0 rounded-none px-6 py-3 flex items-center gap-4">
      <button @click="router.push('/home')" class="text-muted hover:text-ivory transition-colors cursor-pointer bg-transparent border-none text-lg">←</button>
      <h1 class="text-ivory font-semibold">个人中心</h1>
    </header>

    <main class="flex-1 p-6 max-w-2xl mx-auto w-full space-y-6">
      <!-- 用户信息 -->
      <div class="card-panel p-5">
        <div class="grid grid-cols-3 gap-4 text-center">
          <div><p class="text-xs text-muted mb-1">ID</p><p class="text-ivory text-sm font-mono truncate">{{ userStore.id }}</p></div>
          <div><p class="text-xs text-muted mb-1">用户名</p><p class="text-ivory text-sm font-semibold">{{ userStore.username }}</p></div>
          <div><p class="text-xs text-muted mb-1">当前积分</p><p class="text-gold text-lg font-bold">{{ userStore.score.toLocaleString() }}</p></div>
        </div>
      </div>

      <!-- 积分转增 -->
      <div class="card-panel p-5">
        <h3 class="text-ivory font-semibold mb-4">积分转增</h3>
        <div class="flex gap-3 items-end">
          <div class="flex-1">
            <label class="block text-xs text-muted mb-1">目标用户名</label>
            <input v-model="toUsername" type="text" class="input-base text-sm" placeholder="请输入对方用户名" />
          </div>
          <div class="w-32">
            <label class="block text-xs text-muted mb-1">数额</label>
            <input v-model="amount" type="number" class="input-base text-sm" placeholder="正整数" min="1" />
          </div>
          <button @click="handleTransfer" :disabled="submitting"
            class="rounded-lg bg-btn-green hover:bg-btn-green-h text-ivory text-sm font-medium px-5 py-2.5 transition-colors cursor-pointer border-none active:scale-[0.98] disabled:opacity-50 h-[42px]">
            确认
          </button>
        </div>
      </div>

      <!-- 账单明细 -->
      <div class="card-panel p-5">
        <h3 class="text-ivory font-semibold mb-4">账单明细 (近50条)</h3>
        <div v-if="!transactions.length" class="text-center text-muted text-sm py-6">暂无记录</div>
        <div v-else class="space-y-0 max-h-[400px] overflow-y-auto">
          <div v-for="tx in transactions" :key="tx._id"
               class="flex items-center justify-between py-2.5 border-b border-table-border last:border-0">
            <div class="flex-1 min-w-0">
              <p class="text-sm text-ivory truncate">{{ tx.description }}</p>
              <p class="text-xs text-muted mt-0.5">{{ formatTime(tx.createdAt) }}</p>
            </div>
            <div class="text-right ml-4 shrink-0">
              <p class="text-sm font-bold" :class="tx.amount > 0 ? 'text-btn-green' : 'text-btn-red'">
                {{ tx.amount > 0 ? '+' : '' }}{{ tx.amount }}
              </p>
              <p class="text-xs text-muted">余额: {{ tx.balance_after }}</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
