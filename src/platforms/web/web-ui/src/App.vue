<template>
  <div class="app-root">
    <div class="app-background" aria-hidden="true">
      <div class="app-glow glow-primary"></div>
      <div class="app-glow glow-secondary"></div>
      <div class="app-grid"></div>
    </div>

    <AppSidebar
      :mobile-open="sidebarOpen"
      @toggle="sidebarOpen = false"
      @open-settings="handleOpenSettings"
      @open-management-token="handleOpenManagementToken"
      @open-computer-use="handleOpenComputerUse"
      @open-platform-config="handleOpenPlatformConfig"
    />

    <div class="app-main">
      <button
        class="toggle-sidebar"
        type="button"
        :aria-expanded="sidebarOpen"
        aria-label="切换会话侧边栏"
        @click="sidebarOpen = !sidebarOpen"
      >
        <AppIcon :name="ICONS.common.menu" class="toggle-sidebar-icon" />
        <span class="toggle-sidebar-text">会话</span>
      </button>

      <Transition name="fade-veil">
        <button
          v-if="sidebarOpen"
          class="sidebar-backdrop"
          type="button"
          aria-label="关闭侧边栏"
          @click="sidebarOpen = false"
        ></button>
      </Transition>

      <router-view v-slot="{ Component, route }">
        <Transition name="view-fade" mode="out-in">
          <div class="app-view-host" :key="route.fullPath">
            <KeepAlive include="TerminalView">
              <component :is="Component" />
            </KeepAlive>
          </div>
        </Transition>
      </router-view>
    </div>

    <Transition name="panel-modal">
      <SettingsPanel v-if="settingsOpen" @close="settingsOpen = false" />
    </Transition>

    <Transition name="panel-modal">
      <ComputerUsePanel v-if="computerUseOpen" @close="computerUseOpen = false" />
    </Transition>

    <Transition name="panel-modal">
      <PlatformConfigPanel v-if="platformConfigOpen" @close="platformConfigOpen = false" />
    </Transition>

    <ManagementTokenDialog
      v-if="managementTokenOpen"
      @close="managementTokenOpen = false"
      @updated="handleManagementTokenUpdated"
    />

    <ConfirmDialog />
    <ImageLightbox />

    <Transition name="fade-veil">
      <MatrixRain v-if="matrixRainActive" :active="true" @complete="matrixRainActive = false" />
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppSidebar from './components/AppSidebar.vue'
import AppIcon from './components/AppIcon.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import ImageLightbox from './components/ImageLightbox.vue'
import { ICONS } from './constants/icons'
import { onOpenSettingsRequest } from './composables/useAppActions'

const SettingsPanel = defineAsyncComponent(() => import('./components/SettingsPanel.vue'))
const ComputerUsePanel = defineAsyncComponent(() => import('./components/ComputerUsePanel.vue'))
const PlatformConfigPanel = defineAsyncComponent(() => import('./components/PlatformConfigPanel.vue'))
const ManagementTokenDialog = defineAsyncComponent(() => import('./components/ManagementTokenDialog.vue'))
const MatrixRain = defineAsyncComponent(() => import('./components/MatrixRain.vue'))

const router = useRouter()

const sidebarOpen = ref(false)
const settingsOpen = ref(false)
const computerUseOpen = ref(false)
const platformConfigOpen = ref(false)
const managementTokenOpen = ref(false)
const matrixRainActive = ref(false)

// 仅在进入终端视图时触发代码雨（离开时不播放，避免疲劳）
watch(
  () => router.currentRoute.value,
  (to, from) => {
    if (!from || !to) return
    if (to.meta?.terminal && !from.meta?.terminal) {
      matrixRainActive.value = true
    }
  },
)

function handleOpenSettings() {
  settingsOpen.value = true
  sidebarOpen.value = false
}

const unsubSettings = onOpenSettingsRequest((section?: string) => {
  handleOpenSettings()
  if (section) {
    const scrollToSection = () => {
      const el = document.getElementById(`settings-section-${section}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      // 异步组件可能还未渲染完成，用 MutationObserver 等待目标元素出现
      const observer = new MutationObserver(() => {
        const target = document.getElementById(`settings-section-${section}`)
        if (target) {
          observer.disconnect()
          target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
      // 安全兜底：3 秒后自动断开
      setTimeout(() => observer.disconnect(), 3000)
    }
    nextTick(scrollToSection)
  }
})
onBeforeUnmount(unsubSettings)

function handleOpenComputerUse() {
  computerUseOpen.value = true
  sidebarOpen.value = false
}

function handleOpenPlatformConfig() {
  platformConfigOpen.value = true
  sidebarOpen.value = false
}

function handleOpenManagementToken() {
  managementTokenOpen.value = true
  sidebarOpen.value = false
}

function handleManagementTokenUpdated() {
  // 当前无需额外处理，保留钩子便于后续统一刷新管理态
}
</script>
