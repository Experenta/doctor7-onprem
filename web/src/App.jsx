import { Route, Routes } from 'react-router-dom';
import { Screen, Shell } from './components/Guard.jsx';
import Appointments from './pages/Appointments.jsx';
import AppointmentPage from './pages/AppointmentPage.jsx';
import Audit from './pages/Audit.jsx';
import Consultation from './pages/Consultation.jsx';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import NewAppointment from './pages/NewAppointment.jsx';
import NewConsultation from './pages/NewConsultation.jsx';
import { NoPermission } from './components/States.jsx';

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
