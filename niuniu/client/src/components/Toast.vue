<script setup>
import { useToast } from '../composables/useToast'
const { visible, message, type } = useToast()
</script>

<template>
  <Teleport to="body">
    <Transition name="toast">
      <div
        v-if="visible"
        class="fixed top-5 left-1/2 -translate-x-1/2 z-[999] px-5 py-3 rounded-lg shadow-lg text-sm font-medium
               backdrop-blur-sm max-w-[90vw] text-center pointer-events-none"
        :class="type === 'error'
          ? 'bg-btn-red/90 text-ivory'
          : 'bg-btn-green/90 text-ivory'"
      >
        {{ message }}
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.toast-enter-active { transition: all 0.25s ease-out; }
.toast-leave-active { transition: all 0.2s ease-in; }
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -12px);
}
</style>
