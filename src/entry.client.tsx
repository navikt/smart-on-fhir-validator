import React from 'react'

import ReactDOM from 'react-dom/client'
import { HydratedRouter } from 'react-router/dom'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import './index.css'

const queryClient = new QueryClient()

ReactDOM.hydrateRoot(
  document,
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HydratedRouter />
    </QueryClientProvider>
  </React.StrictMode>,
)
