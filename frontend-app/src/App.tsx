import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute/ProtectedRoute'
import Layout from './components/common/Layout'
import Dashboard from './components/Dashboard/Dashboard'
import TenantDetail from './components/TenantDetail/TenantDetail'
import ScheduleEditor from './components/ScheduleEditor/ScheduleEditor'
import SuspendedServices from './components/SuspendedServices/SuspendedServices'
import Login from './components/Login/Login'

function App() {
  // Check if auth is enabled (optional, can be controlled by env var)
  const authEnabled = import.meta.env.VITE_AUTH_ENABLED === 'true'

  if (!authEnabled) {
    // If auth is disabled, render without protection
    return (
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/tenant/:tenantName" element={<TenantDetail />} />
          <Route path="/schedule/new" element={<ScheduleEditor />} />
          <Route path="/schedule/edit/:tenantName" element={<ScheduleEditor />} />
          <Route path="/suspended" element={<SuspendedServices />} />
        </Routes>
      </Layout>
    )
  }

  // If auth is enabled, wrap with AuthProvider and protect routes
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Layout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/tenant/:tenantName" element={<TenantDetail />} />
                  <Route path="/schedule/new" element={<ScheduleEditor />} />
                  <Route path="/schedule/edit/:tenantName" element={<ScheduleEditor />} />
                  <Route path="/suspended" element={<SuspendedServices />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  )
}

export default App

