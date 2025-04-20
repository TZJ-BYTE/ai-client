<template>
  <div class="chat-container">
    <div class="logo-container">
      <img :src="logo" alt="Logo" class="logo" />
      <h1 class="logo-title">AI助手</h1>
    </div>
    <div class="message-container" ref="messageContainer" @scroll="handleScroll">
      <div v-for="(message, index) in messages" 
           :key="index" 
           :class="['message', message.type + '-message', 
                    index === streamingIndex ? 'streaming' : '']">
        <n-card :bordered="false" size="small">
          <template #header>
            <div class="message-header">
              <n-avatar :src="message.type === 'user' ? userAvatar : aiAvatar" round />
              <span class="sender-name">{{ message.type === 'user' ? '用户' : 'AI助手' }}</span>
            </div>
          </template>
          <n-scrollbar>
            <md-preview v-if="message.type === 'user'" 
                       :modelValue="message.content" 
                       :preview-only="true" />
            <div v-else class="ai-content">
              <!-- 思考过程部分 -->
              <div v-if="hasThinkBlock(message.content)" class="think-block">
                <div class="think-header">
                  <span class="think-icon">🤔</span>
                  <span>思考过程</span>
                </div>
                <md-preview :modelValue="extractThinkContent(message.content)" 
                           :preview-only="true" />
              </div>
              <!-- 回答部分 -->
              <md-preview :modelValue="removeThinkBlock(message.content)" 
                         :preview-only="true" />
            </div>
          </n-scrollbar>
        </n-card>
      </div>
    </div>
    <div class="input-container">
      <div class="input-wrapper">
        <n-input 
          v-model:value="inputMessage" 
          type="textarea" 
          :autosize="{ minRows: 1, maxRows: 4 }"
          placeholder="输入消息... (Shift + Enter 换行, Enter 发送)" 
          @keydown="handleKeyDown"
        />
        <n-button type="primary" @click="sendMessage" :loading="loading">
          发送
        </n-button>
      </div>
    </div>
    <div class="status-indicator" :class="connectionStatus">
      {{ connectionStatus === 'connected' ? '已连接' : '连接中...' }}
    </div>
    <div v-if="loading" class="loading-indicator">
      <span>AI正在思考</span>
      <div class="dots">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick, onUnmounted, watch } from 'vue'
import { NInput, NButton, NCard, NAvatar, NScrollbar } from 'naive-ui'
import ReconnectingWebSocket from 'reconnecting-websocket'
import { MdPreview } from 'md-editor-v3'
import 'md-editor-v3/lib/preview.css'
import logo from '@/assets/logo.png'  // 导入 logo

const messages = ref([])
const inputMessage = ref('')
const messageContainer = ref(null)
const loading = ref(false)
const userAvatar = '/user-avatar.png'  // 请确保在public目录下有这些图片
const aiAvatar = '/ai-avatar.png'
const ws = ref(null)
const currentMessage = ref('')
const isReceiving = ref(false)
let heartbeatInterval
const connectionStatus = ref('disconnected')
const streamingMessage = ref('')
const streamingIndex = ref(-1)
const isUserScrolling = ref(false)  // 将其改为响应式变量

// 监听滚动事件
const handleScroll = () => {
  if (!messageContainer.value) return
  const { scrollTop, scrollHeight, clientHeight } = messageContainer.value
  // 如果用户向上滚动，标记为用户正在滚动
  isUserScrolling.value = scrollTop + clientHeight < scrollHeight - 10
}

const scrollToBottom = async (force = false) => {
  await nextTick()
  if (!messageContainer.value) return
  
  const scrollToBottomImpl = () => {
    const container = messageContainer.value
    
    // 计算是否需要滚动
    const { scrollTop, scrollHeight, clientHeight } = container
    const shouldScroll = force || 
                        !isUserScrolling.value || 
                        scrollHeight - scrollTop - clientHeight < 100
    
    if (shouldScroll) {
      container.scrollTo({
        top: scrollHeight,
        behavior: force ? 'auto' : 'smooth'
      })
    }
  }
  
  // 立即执行一次
  scrollToBottomImpl()
  
  // 延迟执行，确保内容已完全渲染
  setTimeout(scrollToBottomImpl, 50)
  setTimeout(scrollToBottomImpl, 150) // 再次尝试，处理长内容
}

const handleWebSocketMessage = (event) => {
  try {
    const data = JSON.parse(event.data)
    
    // 处理心跳响应
    if (data.type === 'pong') {
      return
    }
    
    if (data.done) {
      isReceiving.value = false
      loading.value = false
      if (currentMessage.value) {
        if (streamingIndex.value !== -1) {
          messages.value[streamingIndex.value].content = currentMessage.value
        } else {
          messages.value.push({
            type: 'ai',
            content: currentMessage.value
          })
        }
        currentMessage.value = ''
        streamingIndex.value = -1
        scrollToBottom(true) // 消息结束时强制滚动
      }
    } else if (data.response) { // 确保response字段存在
      isReceiving.value = true
      
      if (!currentMessage.value && data.response.trim() === '<think>') {
        currentMessage.value = '<think>\n'
        streamingIndex.value = messages.value.length
        messages.value.push({
          type: 'ai',
          content: currentMessage.value
        })
        scrollToBottom(true) // 开始新消息时强制滚动
      } else {
        currentMessage.value += data.response
        
        if (streamingIndex.value === -1) {
          streamingIndex.value = messages.value.length
          messages.value.push({
            type: 'ai',
            content: currentMessage.value
          })
          scrollToBottom(true) // 新消息时强制滚动
        } else {
          messages.value[streamingIndex.value].content = currentMessage.value
          scrollToBottom() // 更新内容时平滑滚动
        }
      }
    }
  } catch (error) {
    console.error('处理消息时出错:', error)
    window.$message?.error('消息处理出错')
  }
}

const connectWebSocket = () => {
  if (ws.value && ws.value.readyState === WebSocket.CONNECTING) {
    console.log('WebSocket正在尝试连接中');
    return;
  }

  // 构建WebSocket URL
  const host = window.location.hostname;
  const wsUrl = `ws://${host}:4388/chat`;
  console.log('正在尝试连接WebSocket:', wsUrl);
  
  const options = {
    connectionTimeout: 8000,
    maxRetries: 10,
    maxReconnectionDelay: 10000,
    minReconnectionDelay: 2000,
    reconnectionDelayGrowFactor: 1.5,
    debug: process.env.NODE_ENV === 'development',
    // 自定义重试策略
    shouldReconnect: (event) => {
      // 检查是否是服务器未启动的错误
      if (event.code === 1006) {
        window.$message?.error('无法连接到服务器，请确保后端服务已启动');
        return false; // 停止重试
      }
      return true; // 其他情况继续重试
    }
  };
  
  ws.value = new ReconnectingWebSocket(wsUrl, [], options);
  
  ws.value.onmessage = handleWebSocketMessage;
  
  ws.value.onopen = () => {
    connectionStatus.value = 'connected';
    console.log('WebSocket连接成功');
    window.$message?.success('连接成功');
    heartbeatInterval = setInterval(() => {
      if (ws.value && ws.value.readyState === WebSocket.OPEN) {
        ws.value.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  };
  
  ws.value.onclose = (event) => {
    connectionStatus.value = 'disconnected';
    clearInterval(heartbeatInterval);
    console.log('WebSocket连接关闭，代码:', event.code, '原因:', event.reason);
    if (event.code !== 1000) {
      window.$message?.warning('连接已断开，正在重新连接...');
    }
  };
  
  ws.value.onerror = (error) => {
    console.error('WebSocket连接错误:', {
      url: ws.value.url,
      readyState: ws.value.readyState,
      error: error
    });
    window.$message?.error('连接出现错误，请检查网络');
  };
};

const handleKeyDown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

const sendMessage = () => {
  if (!inputMessage.value.trim() || !ws.value || loading.value) return
  
  loading.value = true
  currentMessage.value = ''
  streamingIndex.value = -1
  isUserScrolling.value = false // 重置滚动状态
  
  messages.value.push({
    type: 'user',
    content: inputMessage.value
  })
  
  const request = {
    prompt: inputMessage.value,
    model: "deepseek-r1",
    stream: true
  }
  
  try {
    ws.value.send(JSON.stringify(request))
    inputMessage.value = ''
    scrollToBottom(true) // 发送消息时强制滚动到底部
  } catch (error) {
    console.error('发送消息失败:', error)
    loading.value = false
    window.$message?.error('发送失败，请重试')
  }
}

// 添加格式化函数
const formatAIResponse = (content) => {
  // 如果内容以```开头，说明是代码块，不需要额外处理
  if (content.trim().startsWith('```')) {
    return content;
  }
  // 检查内容中是否包含代码块标记
  if (content.includes('```')) {
    return content;
  }
  // 普通文本内容保持原样
  return content;
}

// 检查是否包含思考块
const hasThinkBlock = (content) => {
  return content.includes('<think>') && content.includes('</think>')
}

// 提取思考块内容
const extractThinkContent = (content) => {
  const match = content.match(/<think>([\s\S]*?)<\/think>/)
  return match ? match[1].trim() : ''
}

// 移除思考块
const removeThinkBlock = (content) => {
  return content.replace(/<think>[\s\S]*?<\/think>/, '').trim()
}

// 添加防抖函数
const debounce = (fn, delay) => {
  let timeoutId
  return (...args) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }
}

// 优化滚动监听
const setupAutoScroll = () => {
  if (!messageContainer.value) return
  
  // 监听内容变化
  const resizeObserver = new ResizeObserver(
    debounce(() => {
      if (!isUserScrolling.value) {
        scrollToBottom()
      }
    }, 100)
  )
  
  resizeObserver.observe(messageContainer.value)
  
  // 监听消息数量变化
  watch(() => messages.value.length, () => {
    scrollToBottom(true)
  })
  
  return () => {
    resizeObserver.disconnect()
  }
}

onMounted(() => {
  connectWebSocket()
  const cleanup = setupAutoScroll()
  
  onUnmounted(() => {
    cleanup()
    if (ws.value) {
      clearInterval(heartbeatInterval)
      ws.value.close()
    }
  })
})
</script>

<style scoped>
.chat-container {
  /* 计算宽度的公式:
   * 1. 在大屏幕上(>1200px): 固定1200px
   * 2. 在中等屏幕(768px-1200px): 90%的视窗宽度
   * 3. 在小屏幕(<768px): 95%的视窗宽度
   */
  width: min(95vw, min(90vw, 1200px));
  margin: 0 auto;
  padding: clamp(12px, 2vw, 20px);  /* 响应式内边距 */
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #f5f7fa;
}

/* Logo区域样式 */
.logo-container {
  display: flex;
  align-items: center;
  padding: 16px;
  margin-bottom: 20px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.logo {
  width: 40px;
  height: 40px;
  margin-right: 12px;
}

.logo-title {
  font-size: 24px;
  color: #333;
  margin: 0;
}

.message-container {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  gap: 20px;
  display: flex;
  flex-direction: column;
  scroll-behavior: smooth;  /* 添加平滑滚动 */
  
  /* 自定义滚动条样式 */
  &::-webkit-scrollbar {
    width: 6px;
  }
  
  &::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 3px;
  }
  
  &::-webkit-scrollbar-thumb {
    background: #c1c1c1;
    border-radius: 3px;
    
    &:hover {
      background: #a8a8a8;
    }
  }
}

.message {
  /* 在小屏幕上占更大比例，大屏幕上占较小比例 */
  max-width: clamp(75%, calc(70% + 10vw), 88%);
  margin: 8px 0;
  opacity: 0;
  transform: translateY(20px);
  animation: messageSlideIn 0.3s ease forwards;
}

.user-message {
  margin-left: auto;
}

.ai-message {
  margin-right: auto;
}

/* 消息卡片样式 */
:deep(.n-card) {
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  transition: all 0.3s ease;
}

:deep(.n-card:hover) {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

/* 消息头部样式 */
.message-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sender-name {
  font-size: 14px;
  color: #666;
}

.input-container {
  padding: 20px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.05);
  backdrop-filter: blur(10px);
  background: rgba(255, 255, 255, 0.9);
  border-top: 1px solid rgba(0, 0, 0, 0.1);
}

.input-wrapper {
  display: flex;
  gap: 12px;
  position: relative;
}

:deep(.n-input) {
  background: #f9f9f9;
  border-radius: 8px;
  transition: all 0.3s ease;
  
  &:focus {
    transform: translateY(-1px);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  }
}

:deep(.n-button) {
  min-width: 80px;
  border-radius: 8px;
  transition: all 0.3s ease;
  
  &:hover {
    transform: translateY(-1px);
  }
  
  &:active {
    transform: translateY(0);
  }
}

.think-block {
  margin: 12px 0;
  padding: 12px;
  background: #f8f9fa;
  border-left: 4px solid #b4c8e1;
  border-radius: 6px;
  position: relative;
  overflow: hidden;
  
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(45deg, rgba(180, 200, 225, 0.1), transparent);
    pointer-events: none;
  }
  
  .think-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    color: #666;
    font-size: 14px;
    position: relative;
    
    &::after {
      content: '';
      position: absolute;
      bottom: -4px;
      left: 0;
      width: 100%;
      height: 1px;
      background: rgba(0, 0, 0, 0.1);
    }
  }
}

.think-icon {
  font-size: 18px;
}

.ai-content {
  font-size: 15px;
  line-height: 1.6;
}

/* 添加媒体查询进一步优化布局 */
@media screen and (max-width: 768px) {
  .logo-container {
    padding: 12px;
  }
  
  .logo {
    width: 32px;
    height: 32px;
  }
  
  .logo-title {
    font-size: 20px;
  }
  
  .message-container {
    padding: 12px;
  }
  
  .input-container {
    padding: 12px;
  }
}

/* 在非常小的屏幕上进一步调整 */
@media screen and (max-width: 480px) {
  .message {
    max-width: 95%;
  }
  
  :deep(.n-card) {
    padding: 8px;
  }
}

.status-indicator {
  position: fixed;
  bottom: 20px;
  right: 20px;
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 14px;
  transition: all 0.3s ease;
  z-index: 1000;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.connected {
  color: #18a058;
  border: 1px solid #18a058;
}

.disconnected {
  color: #d03050;
  border: 1px solid #d03050;
}

/* 添加动画效果 */
@keyframes pulse {
  0% { opacity: 0.6; }
  50% { opacity: 1; }
  100% { opacity: 0.6; }
}

.disconnected {
  animation: pulse 2s infinite;
}

@keyframes messageSlideIn {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 区分用户和AI消息的样式 */
.user-message :deep(.n-card) {
  background: #e3f2fd;
  border: 1px solid #bbdefb;
}

.ai-message :deep(.n-card) {
  background: #f5f5f5;
  border: 1px solid #e0e0e0;
  
  .ai-content {
    position: relative;
    
    &::after {
      content: '|';
      position: absolute;
      right: -2px;
      bottom: 0;
      color: #666;
      animation: cursor 1s infinite;
      display: none;
    }
  }
  
  &.streaming .ai-content::after {
    display: inline;
  }
}

.loading-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  color: #666;
  
  .dots {
    display: flex;
    gap: 2px;
    
    .dot {
      width: 4px;
      height: 4px;
      background: currentColor;
      border-radius: 50%;
      animation: dotPulse 1.5s infinite;
      
      &:nth-child(2) { animation-delay: 0.2s; }
      &:nth-child(3) { animation-delay: 0.4s; }
    }
  }
}

@keyframes dotPulse {
  0%, 100% { transform: scale(0.5); opacity: 0.5; }
  50% { transform: scale(1); opacity: 1; }
}

@keyframes cursor {
  0%, 100% { opacity: 0; }
  50% { opacity: 1; }
}
</style>

