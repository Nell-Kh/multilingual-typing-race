import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useReducer } from 'react'
import { describe, expect, it } from 'vitest'
import type { Language } from '../../lib/api'
import { initialState, reduce } from './engine'
import { TypingBox } from './TypingBox'

function Harness({ target, language }: { target: string; language: Language }) {
  const [state, dispatch] = useReducer(reduce, initialState(target))
  return (
    <>
      <TypingBox
        state={state}
        language={language}
        onInput={(value, at) => dispatch({ type: 'input', value, at })}
        onRestart={() => dispatch({ type: 'reset', target })}
      />
      <button type="button">elsewhere</button>
    </>
  )
}

describe('TypingBox', () => {
  it('renders English left-to-right', () => {
    render(<Harness target="cat" language="en" />)

    const box = screen.getByTestId('typing-box')
    expect(box).toHaveAttribute('dir', 'ltr')
    expect(box).toHaveAttribute('lang', 'en')
    expect(screen.getByRole('textbox')).toHaveAttribute('dir', 'ltr')
  })

  it.each([
    ['he', 'שלום עולם'],
    ['ar', 'مرحبا بكم'],
  ] as const)('renders %s right-to-left with one span per character', (language, target) => {
    render(<Harness target={target} language={language} />)

    const box = screen.getByTestId('typing-box')
    expect(box).toHaveAttribute('dir', 'rtl')
    expect(box).toHaveAttribute('lang', language)
    expect(screen.getByRole('textbox')).toHaveAttribute('dir', 'rtl')

    const spans = box.querySelectorAll('p > span')
    expect(spans).toHaveLength(Array.from(target).length)
    expect(Array.from(spans, (s) => s.textContent).join('')).toBe(target)
  })

  it('marks Arabic letters correct as they are typed and stops at a mistake', async () => {
    render(<Harness target="مرحبا" language="ar" />)
    const user = userEvent.setup()
    const spans = () => Array.from(screen.getByTestId('typing-box').querySelectorAll('p > span'))

    await user.type(screen.getByRole('textbox'), 'مر')
    expect(spans()[0]).toHaveClass('text-ok')
    expect(spans()[1]).toHaveClass('text-ok')
    expect(spans()[2]).toHaveAttribute('data-caret') // the caret

    await user.type(screen.getByRole('textbox'), 'ب') // should have been ح
    // Wrong is a background and a colour, never colour alone (ADR-032).
    expect(spans()[2]).toHaveClass('bg-err-soft', 'text-err')
    expect(screen.getByRole('textbox')).toHaveValue('مرب')

    await user.type(screen.getByRole('textbox'), 'ح') // ignored: cannot type past a mistake
    expect(screen.getByRole('textbox')).toHaveValue('مرب')
  })

  it('finishes a Hebrew text with final letters typed exactly', async () => {
    render(<Harness target="שלום" language="he" />)
    const user = userEvent.setup()

    await user.type(screen.getByRole('textbox'), 'שלום')

    expect(screen.getByRole('textbox')).toBeDisabled() // finished
  })

  it('says how to start when it does not have the keyboard, and not when it does', async () => {
    render(<Harness target="cat" language="en" />)
    const user = userEvent.setup()
    const box = screen.getByTestId('typing-box')

    // It takes the keyboard on its own when the text arrives.
    expect(screen.getByRole('textbox')).toHaveFocus()
    expect(box).toHaveAttribute('data-focused', 'true')
    expect(screen.queryByTestId('click-to-start')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'elsewhere' }))
    expect(box).toHaveAttribute('data-focused', 'false')
    expect(screen.getByTestId('click-to-start')).toHaveTextContent('Click here or press Tab to type')

    // Keyboard only: Shift+Tab back into the box is enough.
    await user.tab({ shift: true })
    expect(screen.getByRole('textbox')).toHaveFocus()
    expect(screen.queryByTestId('click-to-start')).not.toBeInTheDocument()
  })

  it('Esc starts the text over', async () => {
    render(<Harness target="cat sat" language="en" />)
    const user = userEvent.setup()

    await user.type(screen.getByRole('textbox'), 'cat')
    expect(screen.getByRole('textbox')).toHaveValue('cat')
    await user.keyboard('{Escape}')

    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(screen.getByTestId('typing-box').querySelector('[data-caret]')?.textContent).toBe('c')
  })

  it('draws the caret on the start edge: left in English, right in Arabic', () => {
    const { unmount } = render(<Harness target="ab" language="en" />)
    expect(screen.getByTestId('typing-box').querySelector('[data-caret]')?.className).toContain('inset_2px')
    unmount()
    render(<Harness target="مر" language="ar" />)
    expect(screen.getByTestId('typing-box').querySelector('[data-caret]')?.className).toContain('inset_-2px')
  })
})
