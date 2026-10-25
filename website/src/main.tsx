import React from 'react'
import { createRoot } from 'react-dom/client'
import { Website } from './Website'
import '../../src/renderer/src/styles.css'
import './website.css'

createRoot(document.getElementById('root')!).render(<React.StrictMode><Website /></React.StrictMode>)
