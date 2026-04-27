import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/login' },
  { path: '/login', name: 'Login', component: () => import('../views/LoginView.vue') },
  { path: '/home', name: 'Home', component: () => import('../views/HomeView.vue') },
  { path: '/lobby', name: 'Lobby', component: () => import('../views/LobbyView.vue') },
  { path: '/room/:roomId', name: 'Room', component: () => import('../views/RoomView.vue') },
  { path: '/profile', name: 'Profile', component: () => import('../views/ProfileView.vue'), meta: { requiresAuth: true } },
  { path: '/admin', name: 'Admin', component: () => import('../views/AdminView.vue'), meta: { requiresAuth: true, requiresAdmin: true } }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
