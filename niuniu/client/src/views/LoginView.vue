<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import { useSocket } from '../composables/useSocket'
import { showToast } from '../composables/useToast'

const router = useRouter()
const userStore = useUserStore()
const { connect } = useSocket()

const isRegister = ref(false)
const account = ref('')
const password = ref('')
const confirmPassword = ref('')
const phone = ref('')
const errorMsg = ref('')
const submitting = ref(false)

async function handleRegister() {
  submitting.value = true; errorMsg.value = ''
  try {
    const res = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: account.value.trim(), password: password.value, phone: phone.value.trim() }) })
    const data = await res.json()
    if (!data.ok) { showToast(data.msg, 'error'); return }
    showToast('注册成功', 'success'); userStore.login(data.data); connect(data.data.id, data.data.username); router.push('/home')
  } catch { showToast('网络异常', 'error') } finally { submitting.value = false }
}

async function handleLogin() {
  submitting.value = true; errorMsg.value = ''
  try {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: account.value.trim(), password: password.value }) })
    const data = await res.json()
    if (!data.ok) { showToast(data.msg, 'error'); return }
    userStore.login(data.data); connect(data.data.id, data.data.username); router.push('/home')
  } catch { showToast('网络异常', 'error') } finally { submitting.value = false }
}

function handleSubmit() {
  const name = account.value.trim(), pwd = password.value.trim()
  if (!name) { errorMsg.value = '请输入账号'; return } if (name.length < 2) { errorMsg.value = '账号至少2个字符'; return }
  if (!pwd) { errorMsg.value = '请输入密码'; return } if (pwd.length < 4) { errorMsg.value = '密码至少4位'; return }
  if (isRegister.value) {
    const ph = phone.value.trim()
    if (!ph) { errorMsg.value = '请输入手机号'; return } if (!/^1\d{10}$/.test(ph)) { errorMsg.value = '请输入正确的11位手机号'; return }
    if (pwd !== confirmPassword.value.trim()) { errorMsg.value = '两次密码不一致'; return }
    errorMsg.value = ''; handleRegister()
  } else { errorMsg.value = ''; handleLogin() }
}

function toggleMode() { isRegister.value = !isRegister.value; errorMsg.value = ''; confirmPassword.value = ''; phone.value = '' }
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="card-panel w-full max-w-sm p-8">
      <div class="text-center mb-8">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-table-felt mb-4"><span class="text-2xl font-bold text-gold-light">牛</span></div>
        <h1 class="text-xl font-bold text-ivory">休闲联机游戏</h1><p class="text-sm text-muted mt-1">斗牛 · 经典纸牌</p>
      </div>
      <form @submit.prevent="handleSubmit" class="space-y-4">
        <div><label class="block text-sm text-muted mb-1.5">{{ isRegister ? '用户名' : '账号' }}</label><input v-model="account" type="text" class="input-base" :placeholder="isRegister ? '请输入用户名' : '请输入用户名或手机号'" autocomplete="username" /></div>
        <div v-if="isRegister"><label class="block text-sm text-muted mb-1.5">手机号</label><input v-model="phone" type="tel" class="input-base" placeholder="请输入11位手机号" maxlength="11" /></div>
        <div><label class="block text-sm text-muted mb-1.5">密码</label><input v-model="password" type="password" class="input-base" placeholder="请输入密码" /></div>
        <div v-if="isRegister"><label class="block text-sm text-muted mb-1.5">确认密码</label><input v-model="confirmPassword" type="password" class="input-base" placeholder="请再次输入密码" /></div>
        <p v-if="errorMsg" class="text-sm text-btn-red">{{ errorMsg }}</p>
        <button type="submit" class="btn-primary flex items-center justify-center gap-2" :disabled="submitting"><span v-if="submitting" class="w-4 h-4 border-2 border-ivory/30 border-t-ivory rounded-full animate-spin"></span>{{ isRegister ? '注 册' : '登 录' }}</button>
      </form>
      <p class="text-center text-sm text-muted mt-5"><span>{{ isRegister ? '已有账号？' : '没有账号？' }}</span><button @click="toggleMode" class="text-gold hover:text-gold-light ml-1 cursor-pointer bg-transparent border-none">{{ isRegister ? '去登录' : '去注册' }}</button></p>
    </div>
  </div>
</template>
