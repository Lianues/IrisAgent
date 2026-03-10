import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import './styles/main.css'
import { useTheme } from './composables/useTheme'

// 初始化主题（在 mount 前调用确保 data-theme 属性已设置，防止闪屏）
useTheme()

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./views/ChatView.vue') },
    { path: '/deploy', component: () => import('./views/DeployView.vue') },
  ],
})

const app = createApp(App)
app.use(router)
app.mount('#app')
