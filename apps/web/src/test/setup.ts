import { configure } from '@testing-library/react';

// Portalled popups (pickers, menus) can take a few seconds to appear when the
// whole monorepo runs its tests in parallel; one generous default for findBy*.
configure({ asyncUtilTimeout: 5000 });
