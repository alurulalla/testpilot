import { test, expect } from './fixtures.js'
import { TARGET_URL } from './fixtures.js'

test.describe('Ollama Pricing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${TARGET_URL}/pricing`)
  })

  test('page loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Pricing.*Ollama|Ollama.*Pricing/)
  })

  test('main heading "Pricing" is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Pricing', level: 1 })).toBeVisible()
  })

  test('Free plan heading and details are visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Free', level: 2 })).toBeVisible()
    await expect(page.getByText('Get started with Ollama')).toBeVisible()
    await expect(page.getByText('$0')).toBeVisible()
  })

  test('Pro plan heading and pricing are visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Pro', level: 2 })).toBeVisible()
    await expect(page.getByText('Solve harder tasks, faster')).toBeVisible()
    await expect(page.getByText('$20 / mo')).toBeVisible()
  })

  test('Max plan heading and pricing are visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Max', level: 2 })).toBeVisible()
    await expect(page.getByText('For your most demanding work')).toBeVisible()
    await expect(page.getByText('$100 / mo')).toBeVisible()
  })

  test('Free plan Download link is present', async ({ page }) => {
    const downloadLinks = page.getByRole('link', { name: 'Download' })
    await expect(downloadLinks.first()).toBeVisible()
  })

  test('"Get Pro" link is present and points to upgrade URL', async ({ page }) => {
    const getProLink = page.getByRole('link', { name: 'Get Pro' })
    await expect(getProLink).toBeVisible()
    await expect(getProLink).toHaveAttribute('href', '/upgrade?plan=pro')
  })

  test('"Get Max" link is present and points to upgrade URL', async ({ page }) => {
    const getMaxLink = page.getByRole('link', { name: 'Get Max' })
    await expect(getMaxLink).toBeVisible()
    await expect(getMaxLink).toHaveAttribute('href', '/upgrade?plan=max')
  })

  test('"annually" link for Pro yearly billing is present', async ({ page }) => {
    const annuallyLink = page.getByRole('link', { name: 'annually' })
    await expect(annuallyLink).toBeVisible()
    await expect(annuallyLink).toHaveAttribute('href', '/upgrade?plan=pro&interval=year')
  })

  test('Pro plan annual billing text is visible', async ({ page }) => {
    await expect(page.getByText('or $200/yr billed')).toBeVisible()
  })

  test('Free plan features list items are visible', async ({ page }) => {
    await expect(page.getByText('Automate coding, document analysis, and other tasks with open models')).toBeVisible()
    await expect(page.getByText('Keep your data private')).toBeVisible()
    await expect(page.getByText('Run models on your hardware')).toBeVisible()
    await expect(page.getByText('Access cloud models')).toBeVisible()
    await expect(page.getByText('CLI, API, and desktop apps')).toBeVisible()
    await expect(page.getByText('40,000+ community integrations')).toBeVisible()
    await expect(page.getByText('Unlimited public models')).toBeVisible()
  })

  test('Pro plan features list items are visible', async ({ page }) => {
    await expect(page.getByText('Access larger, more powerful cloud models')).toBeVisible()
    await expect(page.getByText('Run 3 cloud models at a time')).toBeVisible()
    await expect(page.getByText('50x more cloud usage than Free')).toBeVisible()
    await expect(page.getByText('Upload and share private models')).toBeVisible()
  })

  test('Max plan features list items are visible', async ({ page }) => {
    await expect(page.getByText('Run 10 cloud models at a time')).toBeVisible()
    await expect(page.getByText('5x more usage than Pro')).toBeVisible()
  })

  test('"Everything in Free, plus:" text is visible', async ({ page }) => {
    await expect(page.getByText('Everything in Free, plus:')).toBeVisible()
  })

  test('"Everything in Pro, plus:" text is visible', async ({ page }) => {
    await expect(page.getByText('Everything in Pro, plus:')).toBeVisible()
  })

  test('FAQ section heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Frequently asked questions', level: 2 })).toBeVisible()
  })

  test('FAQ Models sub-heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Models', level: 3 })).toBeVisible()
  })

  test('FAQ question "Which models are available?" is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Which models are available?' })).toBeVisible()
  })

  test('FAQ question "Do models support tool calling?" is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Do models support tool calling?' })).toBeVisible()
  })

  test('FAQ "here" link for cloud models is present', async ({ page }) => {
    await expect(page.getByText('See the full list of cloud-enabled models')).toBeVisible()
    const hereLinks = page.getByRole('link', { name: 'here' })
    await expect(hereLinks.first()).toHaveAttribute('href', '/search?c=cloud')
  })

  test('header navigation contains correct links', async ({ page }) => {
    const nav = page.getByRole('banner').getByRole('navigation')
    await expect(nav.getByRole('link', { name: 'Ollama' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Models' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Docs' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Pricing' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Sign in' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Download' }).first()).toBeVisible()
  })

  test('search input is present in navigation', async ({ page }) => {
    const searchInput = page.getByRole('textbox', { name: 'Search models' })
    await expect(searchInput).toBeVisible()
  })

  test('search form has correct action and method', async ({ page }) => {
    const form = page.locator('form[action="/search"][method="GET"]')
    await expect(form).toBeAttached()
  })

  test('footer is visible with expected links', async ({ page }) => {
    const footer = page.getByRole('contentinfo')
    await expect(footer).toBeVisible()
    await expect(footer.getByRole('link', { name: 'Privacy' }).first()).toBeVisible()
    await expect(footer.getByRole('link', { name: 'Terms' }).first()).toBeVisible()
  })

  test('footer external links are present', async ({ page }) => {
    const footer = page.getByRole('contentinfo')
    await expect(footer.getByRole('link', { name: 'GitHub' }).first()).toBeVisible()
    await expect(footer.getByRole('link', { name: 'Discord' }).first()).toBeVisible()
    await expect(footer.getByRole('link', { name: 'X (Twitter)' }).first()).toBeVisible()
  })

  test('footer Blog link is present', async ({ page }) => {
    const footer = page.getByRole('contentinfo')
    await expect(footer.getByRole('link', { name: 'Blog' }).first()).toBeVisible()
  })

  test('clicking Models nav link navigates to search page', async ({ page }) => {
    const nav = page.getByRole('banner').getByRole('navigation')
    await nav.getByRole('link', { name: 'Models' }).click()
    await expect(page).toHaveURL(`${TARGET_URL}/search`)
  })

  test('clicking Sign in link navigates to sign in page', async ({ page }) => {
    const nav = page.getByRole('banner').getByRole('navigation')
    await nav.getByRole('link', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(`${TARGET_URL}/signin`)
  })

  test('clicking Docs link navigates to docs page', async ({ page }) => {
    const nav = page.getByRole('banner').getByRole('navigation')
    await nav.getByRole('link', { name: 'Docs' }).click()
    await expect(page).toHaveURL(/docs/)
  })

  test('main content area is present', async ({ page }) => {
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('Ollama logo in header navigates to home', async ({ page }) => {
    const nav = page.getByRole('banner').getByRole('navigation')
    const logoLink = nav.getByRole('link', { name: 'Ollama' })
    await expect(logoLink).toHaveAttribute('href', '/')
  })

  test('search input accepts text input', async ({ page }) => {
    const searchInput = page.getByRole('textbox', { name: 'Search models' })
    await searchInput.fill('llama')
    await expect(searchInput).toHaveValue('llama')
  })

  test('Privacy link in footer navigates correctly', async ({ page }) => {
    const footer = page.getByRole('contentinfo')
    const privacyLink = footer.getByRole('link', { name: 'Privacy' }).first()
    await expect(privacyLink).toHaveAttribute('href', '/privacy')
  })

  test('Terms link in footer navigates correctly', async ({ page }) => {
    const footer = page.getByRole('contentinfo')
    const termsLink = footer.getByRole('link', { name: 'Terms' }).first()
    await expect(termsLink).toHaveAttribute('href', '/terms')
  })

  test('Usage FAQ heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Usage', level: 3 })).toBeVisible()
  })

  test('Privacy FAQ heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Privacy', level: 3 })).toBeVisible()
  })
})