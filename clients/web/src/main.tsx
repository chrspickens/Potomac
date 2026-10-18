import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { V2CombatApp } from './v2-combat'
import { V2DicePoolApp } from './v2-dicepool'
import './index.css'

createRoot(document.getElementById('root')!).render(<React.StrictMode>{window.location.pathname === '/v2-combat' ? <V2CombatApp /> : window.location.pathname === '/v2-dicepool' ? <V2DicePoolApp /> : <App />}</React.StrictMode>)
