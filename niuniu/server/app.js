import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { initSocket } from './sockets/index.js'

import userRoutes from './routes/userRoutes.js'
import transferRoutes from './routes/transferRoutes.js'
import adminRoutes from './routes/adminRoutes.js'

const app = express()
const httpServer = createServer(app)

// 全局中间件
app.use(cors({ origin: '*', credentials: true }))
app.use(express.json())

// REST API 路由
app.use('/api', userRoutes)
app.use('/api', transferRoutes)
app.use('/api', adminRoutes)

// 健康检查
app.get('/', (_req, res) => res.send('牛牛服务器运行中...'))

// 初始化 WebSocket（传入原始的 httpServer，让 sockets/index.js 内部创建 io）
initSocket(httpServer)

// 注意：这里不调用 httpServer.listen()，启动统一交给 index.js
export { app, httpServer }