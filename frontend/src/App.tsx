import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { startApp } from './services'
import { Shell } from './components/Shell'
import { Toasts } from './components/ui'
import Library from './pages/Library'
import Settings from './pages/Settings'
import Unlock from './pages/Unlock'
import Welcome from './pages/Welcome'
import { useIdentity } from './stores/identity'
import { applyTheme, settings, useSettings } from './stores/settings'

export default function App() {
  const id = useIdentity()
  const { theme, confirmed } = useSettings()

  useEffect(() => {
    void settings.loadDeploymentDefaults().then(startApp)
  }, [])
  useEffect(() => applyTheme(theme), [theme])

  if (id.phase === 'none' || (id.phase === 'unlocked' && !confirmed)) {
    return (
      <>
        <Welcome />
        <Toasts />
      </>
    )
  }
  if (id.phase === 'locked') {
    return (
      <>
        <Unlock />
        <Toasts />
      </>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Library />} />
          <Route path="m/:sha" element={<Library />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
