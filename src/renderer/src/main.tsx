import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { FilterWindow } from './FilterWindow'
import './styles.css'

const isFilterWindow = window.location.hash === '#/filters'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isFilterWindow ? <FilterWindow /> : <App />}
  </StrictMode>
)
