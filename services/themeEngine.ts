import { kvService } from './kv';

const THEME_STORAGE_KEY = 'gchat_active_theme';

export class ThemeEngine {
    private static activeTheme: string | null = null;

    // We expect themes to be located at /themes/[name]/theme.css
    public static async init() {
        const savedTheme = await kvService.get<string>(THEME_STORAGE_KEY);
        if (savedTheme) {
            this.setTheme(savedTheme);
        }
    }

    public static async setTheme(themeName: string | null) {
        // Remove existing theme link if any
        const existingLink = document.getElementById('gchat-theme-link');
        if (existingLink) {
            existingLink.remove();
        }

        if (themeName) {
            const link = document.createElement('link');
            link.id = 'gchat-theme-link';
            link.rel = 'stylesheet';
            link.href = `/themes/${themeName}/theme.css`;
            document.head.appendChild(link);
            await kvService.set(THEME_STORAGE_KEY, themeName);
        } else {
            await kvService.set(THEME_STORAGE_KEY, null);
        }

        this.activeTheme = themeName;
    }

    public static getActiveTheme() {
        return this.activeTheme;
    }
}
