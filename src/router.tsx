import { createBrowserRouter } from "react-router-dom";
import App from "./App";
import Login from "./pages/Login";
import Callback from "./pages/Callback";
import Home from "./pages/Home";
import NotFound from "./pages/NotFound";
import TaOnboarding from "./pages/ta/Onboarding";
import TaAvailability from "./pages/ta/Availability";
import TaSchedule from "./pages/ta/Schedule";
import TaHours from "./pages/ta/Hours";
import PeriodSetup from "./pages/coordinator/PeriodSetup";
import DutyTypes from "./pages/coordinator/DutyTypes";
import Shifts from "./pages/coordinator/Shifts";
import Roster from "./pages/coordinator/Roster";
import Builder from "./pages/coordinator/Builder";
import CoordinatorHours from "./pages/coordinator/Hours";
import Changelog from "./pages/coordinator/Changelog";

export const router = createBrowserRouter(
  [
    { path: "/login", element: <Login /> },
    { path: "/callback", element: <Callback /> },
    {
      path: "/",
      element: <App />,
      children: [
        { index: true, element: <Home /> },
        { path: "ta/onboarding", element: <TaOnboarding /> },
        { path: "ta/availability", element: <TaAvailability /> },
        { path: "ta/schedule", element: <TaSchedule /> },
        { path: "ta/hours", element: <TaHours /> },
        { path: "coordinator/setup", element: <PeriodSetup /> },
        { path: "coordinator/duty-types", element: <DutyTypes /> },
        { path: "coordinator/shifts", element: <Shifts /> },
        { path: "coordinator/roster", element: <Roster /> },
        { path: "coordinator/builder", element: <Builder /> },
        { path: "coordinator/hours", element: <CoordinatorHours /> },
        { path: "coordinator/changelog", element: <Changelog /> },
        { path: "*", element: <NotFound /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
);
