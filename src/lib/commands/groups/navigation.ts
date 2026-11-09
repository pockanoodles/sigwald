import { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import {
  HiOutlineCalendar,
  HiOutlineClipboardList,
  HiOutlineCog,
  HiOutlineHome,
  HiOutlineLightningBolt,
  HiOutlineMenu,
  HiOutlinePuzzle,
} from "react-icons/hi";

import { CLIENT_MODULES } from "@/modules/client";

import { useOnModules } from "@/store/modules";
import { useNavUIStore } from "@/store/navUi";

import { Command } from "../types";

export function useNavigationCommands(): Command[] {
  const { isNavOpen, setNavOpen } = useNavUIStore();
  const modules = useOnModules();

  // A module that's on gets its "Go to" entry; one that's off has none.
  const moduleCommands: Command[] = modules.flatMap((m) => {
    const command = CLIENT_MODULES[m.id].command;
    if (!m.page || !command) return [];
    const href = m.page.href;
    const { icon, shortcut } = command;
    return [
      {
        id: `navigation.${m.id}`,
        title: `Go to ${m.name}`,
        keywords: ["navigation", ...m.page.keywords],
        icon,
        section: "navigation" as const,
        shortcut,
        perform: (router?: AppRouterInstance) => {
          if (router) router.push(href);
        },
      },
    ];
  });

  return [
    {
      id: "navigation.today",
      title: "Go to Today",
      keywords: ["navigation", "home", "queue", "dashboard"],
      icon: HiOutlineHome,
      section: "navigation",
      shortcut: "gd",
      perform: (router?: AppRouterInstance) => {
        if (router) router.push("/today");
      },
    },
    {
      id: "navigation.calendar",
      title: "Go to Calendar",
      keywords: ["navigation"],
      icon: HiOutlineCalendar,
      section: "navigation",
      shortcut: "gc",
      perform: (router?: AppRouterInstance) => {
        if (router) router.push("/calendar");
      },
    },
    {
      id: "navigation.tasks",
      title: "Go to Tasks",
      keywords: ["navigation"],
      icon: HiOutlineClipboardList,
      section: "navigation",
      shortcut: "gt",
      perform: (router?: AppRouterInstance) => {
        if (router) router.push("/tasks");
      },
    },
    {
      id: "navigation.focus",
      title: "Go to Focus",
      keywords: ["navigation"],
      icon: HiOutlineLightningBolt,
      section: "navigation",
      shortcut: "gf",
      perform: (router?: AppRouterInstance) => {
        if (router) router.push("/focus");
      },
    },
    ...moduleCommands,
    {
      id: "navigation.modules",
      title: "Go to Modules",
      keywords: [
        "navigation",
        "modules",
        "add",
        "turn on",
        "turn off",
        "catalog",
      ],
      icon: HiOutlinePuzzle,
      section: "navigation",
      perform: (router?: AppRouterInstance) => {
        if (router) router.push("/modules");
      },
    },
    {
      id: "navigation.settings",
      title: "Go to Settings",
      keywords: ["navigation"],
      icon: HiOutlineCog,
      section: "navigation",
      shortcut: "gs",
      perform: (router?: AppRouterInstance) => {
        if (router) router.push("/settings");
      },
    },
    {
      // The rail collapses to zero width, so this and the edge tab in AppNav
      // are the only ways back in — registering it here rather than as a bare
      // keydown gets it into the palette and the shortcuts sheet for free.
      id: "navigation.toggle-sidebar",
      title: "Toggle Sidebar",
      keywords: ["sidebar", "nav", "rail", "toggle", "collapse", "expand"],
      icon: HiOutlineMenu,
      section: "navigation",
      shortcut: "meta+\\",
      perform: () => setNavOpen(!isNavOpen),
    },
  ];
}
