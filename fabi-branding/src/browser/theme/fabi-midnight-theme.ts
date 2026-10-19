import { fabiIslandsTheme } from './fabi-islands-theme';
import cursorDark = require('./vendor/cursor-dark/theme.json');

/** Fabi shell palette. Editor and terminal colors below come from Cursor Dark. */
const palette: Record<string, string> = {
    '#101113': '#121316', '#161619': '#191a1e', '#141416': '#17181c',
    '#22262d': '#191a1e', '#1e2024': '#202127', '#2f333b': '#292a32',
    '#3c3f41': '#35363f', '#3c3f45': '#30313a', '#25262a': '#30313a',
    '#bcbec4': '#d7d7df', '#f3ece6': '#e5e2ed', '#7a7e85': '#92929e',
    '#6f737a': '#858591', '#555861': '#858591', '#4e5157': '#62626e',
    '#8a9099': '#aaa4c9', '#9aa0a6': '#beb4d9', '#cfd1d6': '#e1dce9',
    '#ec5b2b': '#b9b4d6', '#f06d40': '#d0cce3', '#3a2a20': '#383442',
    '#56a8f5': '#9cbde0', '#c77dbb': '#c7b7d7', '#6aab73': '#a4c5a6',
    '#2aacb8': '#a2c9cd', '#bbb529': '#d1c18e', '#73b00a': '#91b99b',
    '#f75464': '#e6949c', '#e8a33e': '#d8bd8b', '#32593d': '#3d4738'
};

function midnightColor(value: string): string {
    const color = value.toLowerCase();
    const replacement = palette[color.slice(0, 7)];
    return replacement ? replacement + color.slice(7) : value;
}

const inheritedColors: Record<string, string> = {};
for (const [key, value] of Object.entries(fabiIslandsTheme.colors)) {
    inheritedColors[key] = midnightColor(value);
}
// Vendor's VS Code theme data, unchanged. Monaco/TextMate and xterm consume
// the same standard keys as VS Code; no desaturation or per-language recoloring.
const codeColors = Object.fromEntries(Object.entries(cursorDark.colors)
    .filter(([key]) => /^(editor|terminal|diffEditor|gitDecoration)/.test(key)));

export const fabiMidnightTheme = {
    name: 'Fabi Midnight',
    type: 'dark',
    colors: {
        ...inheritedColors,
        'focusBorder': '#00000000',
        'foreground': '#d7d7df',
        'descriptionForeground': '#92929e',
        'widget.border': '#35363f',
        'widget.shadow': '#08090b66',
        'settings.rowHoverBackground': '#ffffff03',
        'settings.focusedRowBackground': '#24252b',
        'settings.focusedRowBorder': '#00000000',
        'settings.modifiedItemIndicator': '#b9b4d6',
        'notifications.background': '#24252b',
        'notifications.foreground': '#d7d7df',
        'notifications.border': '#35363f',
        'notificationCenterHeader.background': '#292a32',
        'notificationCenterHeader.foreground': '#d7d7df',
        'notificationLink.foreground': '#b9b4d6',
        'notificationsInfoIcon.foreground': '#9cbde0',
        'notificationsWarningIcon.foreground': '#d8bd8b',
        'notificationsErrorIcon.foreground': '#e6949c',
        'button.background': '#d7d9e2',
        'button.foreground': '#24252b',
        'button.hoverBackground': '#eff0f5',
        'button.secondaryBackground': '#292a32',
        'button.secondaryForeground': '#d7d7df',
        'button.secondaryHoverBackground': '#35363f',
        'badge.background': '#35353f',
        'badge.foreground': '#d7d7df',
        'input.background': '#17181c',
        'input.border': '#35363f',
        'input.foreground': '#e1e1e8',
        'input.placeholderForeground': '#92929e',
        'list.activeSelectionBackground': '#383442',
        'list.activeSelectionForeground': '#e5e2ed',
        'list.inactiveSelectionBackground': '#292a32',
        'list.hoverBackground': '#24252b',
        'list.focusBackground': '#383442',
        'list.focusOutline': '#00000000',
        'list.inactiveFocusOutline': '#b9b4d644',
        'tab.activeBackground': '#23242a',
        'tab.activeForeground': '#e6e5ed',
        'tab.inactiveBackground': '#191a1e',
        'tab.inactiveForeground': '#92929e',
        'tab.hoverBackground': '#24252b',
        'tab.border': '#191a1e',
        'panel.background': '#121316',
        'statusBar.background': '#191a1e',
        'statusBar.foreground': '#92929e',
        'statusBar.noFolderForeground': '#92929e',
        ...codeColors
    },
    tokenColors: cursorDark.tokenColors,
    semanticHighlighting: cursorDark.semanticHighlighting,
    semanticTokenColors: cursorDark.semanticTokenColors
};
