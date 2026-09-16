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
    <TypingBox
      state={state}
      language={language}
      onInput={(value, at) => dispatch({ type: 'input', value, at })}
    />
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
    expect(spans()[0]).toHaveClass('text-green-700')
    expect(spans()[1]).toHaveClass('text-green-700')
    expect(spans()[2]).toHaveClass('border-b-2') // the caret

    await user.type(screen.getByRole('textbox'), 'ب') // should have been ح
    expect(spans()[2]).toHaveClass('bg-red-200')
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
})
