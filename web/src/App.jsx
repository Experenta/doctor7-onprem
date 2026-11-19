import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Screen, Shell } from './components/Guard.jsx';
import Login from './pages/Login.jsx';
import { NoPermission } from './components/States.jsx';

// Each screen loads when it is first shown. Login stays in the initial bundle,
// because every visitor reaches it first. Screen renders its children inside a
// Suspense boundary, and only after the role check, so a role that may not use a
// screen never loads its code.
const Home = lazy(() => import('./pages/Home.jsx'));
const Appointments = lazy(() => import('./pages/Appointments.jsx'));
const AppointmentPage = lazy(() => import('./pages/AppointmentPage.jsx'));
const NewAppointment = lazy(() => import('./pages/NewAppointment.jsx'));
const NewConsultation = lazy(() => import('./pages/NewConsultation.jsx'));
const Consultation = lazy(() => import('./pages/Consultation.jsx'));
const Audit = lazy(() => import('./pages/Audit.jsx'));

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Screen id="home"><Home /></Screen>} />
        <Route path="/appointments" element={<Screen id="appointments"><Appointments /></Screen>} />
        <Route path="/appointments/new" element={<Screen id="newAppointment"><NewAppointment /></Screen>} />
        <Route path="/appointments/:id" element={<Screen id="appointment"><AppointmentPage /></Screen>} />
        <Route
          path="/appointments/:id/consultation"
          element={<Screen id="newConsultation"><NewConsultation /></Screen>}
        />
        <Route path="/consultations/:id" element={<Screen id="consultation"><Consultation /></Screen>} />
        <Route path="/audit" element={<Screen id="audit"><Audit /></Screen>} />
        <Route path="*" element={<NoPermission />} />
      </Route>
    </Routes>
  );
}
