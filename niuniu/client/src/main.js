import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useUserStore } from './stores/user'
import './style.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)

router.beforeEach((to, from, next) => {
  const userStore = useUserStore()
  if (to.name !== 'Login' && !userStore.isLoggedIn) {
    next({ name: 'Login' })
  } else if (to.meta.requiresAdmin && userStore.role !== 'admin') {
    next({ name: 'Home' })
  } else {
    next()
  }
})

app.mount('#app')
