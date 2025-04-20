<script setup>
import { NConfigProvider, NMessageProvider } from 'naive-ui'
</script>

<template>
  <n-config-provider>
    <n-message-provider>
      <div class="app-container">
        <router-view></router-view>
      </div>
    </n-message-provider>
  </n-config-provider>
</template>

<style>
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  width: 100%;
}

#app {
  height: 100vh;
  width: 100vw;
  display: flex;
  overflow-x: hidden;
}

.app-container {
  flex: 1;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* 聊天相关样式 */
.chat-wrapper {
  flex: 1;
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 20px;
  box-sizing: border-box;
}

.chat-container {
  width: 100%;
  max-width: none;
  min-width: auto;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
}

.message-list {
  width: 100%;
  display: flex;
  flex-direction: column;
}

.message-item {
  width: 100%;
  margin: 10px 0;
}

.input-area {
  width: 100%;
  padding: 20px;
  background: #fff;
  border-top: 1px solid #eee;
  position: sticky;
  bottom: 0;
}

/* 移除之前的一些样式 */
.container,
.main-content {
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 0;
}

@media (max-width: 768px) {
  .chat-wrapper {
    padding: 10px;
  }
  
  .input-area {
    padding: 10px;
  }

  .chat-container {
    width: 100%;
    min-width: auto;
  }
}

@media (max-width: 1200px) {
  .chat-container {
    min-width: 100%;
  }
}
</style>
