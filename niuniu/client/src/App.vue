<template>
  <router-view />
  <Toast />
  <ReconnectModal />
</template>

<script setup>
import Toast from './components/Toast.vue'
import ReconnectModal from './components/ReconnectModal.vue'
</script>
