import { cva } from 'class-variance-authority'
import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'
import '../tailwind.css'
import { cx } from './cx'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'toolbar'

/** Icon size per button size (Components page: 14 / 16 / 18, toolbar buttons 15). */
const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18, toolbar: 15 }

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: LucideIcon
}

/** The wash the three unfilled variants take on hover. */
const HOVER_WASH = 'not-disabled:hover:bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)]'

const BUTTON =
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-8 m-0 rounded-sm border-0 bg-transparent font-sans font-semibold leading-normal whitespace-nowrap [&_svg]:shrink-0 focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-default disabled:opacity-40'

/**
 * The four sizes and the five variants, in the order `button.css` resolved them.
 *
 * That order is the whole of the table: an outlined button gives a pixel of its padding back to
 * its stroke, an icon-only one is square, and where the two meet the sheet's own cascade picked
 * the outline — `[data-slot=button][data-variant=outline][data-slot=button]--sm` and `[data-slot=button][data-variant=icon]-only[data-slot=button]--sm`
 * weigh the same and the outline rule came later in the file. The compounds are written in that
 * order here, and `cx` settles them the way the cascade did.
 */
const button = cva(BUTTON, {
  variants: {
    size: {
      sm: 'px-13 py-7 text-13/[normal]',
      md: 'px-18 py-11 text-14/[normal]',
      lg: 'px-24 py-14 text-16/[normal]',
      toolbar: 'px-14 py-8 text-13/[normal]',
    },
    variant: {
      primary: 'bg-primary text-primary-foreground shadow-button-primary not-disabled:hover:bg-primary-hover',
      secondary: cx('bg-secondary text-secondary-foreground', HOVER_WASH),
      outline: cx('border border-border px-17 py-10 text-foreground', HOVER_WASH),
      ghost: cx('text-muted-foreground', HOVER_WASH),
      destructive:
        'bg-destructive text-destructive-foreground not-disabled:hover:bg-[color-mix(in_srgb,var(--destructive)_88%,var(--black))]',
    },
    iconOnly: { true: '', false: '' },
  },
  compoundVariants: [
    { iconOnly: true, size: 'sm', class: 'p-7' },
    { iconOnly: true, size: 'md', class: 'p-11' },
    { iconOnly: true, size: 'lg', class: 'p-14' },
    { iconOnly: true, size: 'toolbar', class: 'p-8' },
    { variant: 'outline', size: 'sm', class: 'px-12 py-6' },
    { variant: 'outline', size: 'lg', class: 'px-23 py-13' },
    { variant: 'outline', size: 'toolbar', class: 'px-13 py-7' },
  ],
  defaultVariants: { size: 'md', variant: 'primary', iconOnly: false },
})

export function Button({ variant = 'primary', size = 'md', icon: Icon, className, children, ...rest }: ButtonProps) {
  const iconOnly = children === undefined || children === null
  return (
    <button
      type="button"
      data-ui="Button"
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cx(button({ variant, size, iconOnly }), className)}
      {...rest}
    >
      {Icon && <Icon size={ICON_SIZE[size]} aria-hidden />}
      {!iconOnly && <span data-slot="button-label">{children}</span>}
    </button>
  )
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon
  /** Accessible name; icon buttons have no visible label. */
  label: string
  /** md: the 40×40 outlined square (Button/Icon); sm: the borderless 30×30 row menu. */
  size?: 'md' | 'sm'
  /** The icon's own size, when a frame draws it smaller than the size's 18 / 16. */
  iconSize?: number
}

const ICON_BUTTON =
  'size-40 border border-border p-0 text-14/[normal] text-muted-foreground not-disabled:hover:bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)] not-disabled:hover:text-foreground'
const ICON_BUTTON_SM = 'size-30 border-0'

export function IconButton({ icon: Icon, label, size = 'md', iconSize, className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      data-ui="Button"
      data-slot="button"
      data-variant="icon"
      data-size={size}
      aria-label={label}
      title={label}
      className={cx(BUTTON, ICON_BUTTON, size === 'sm' && ICON_BUTTON_SM, className)}
      {...rest}
    >
      <Icon size={iconSize ?? (size === 'sm' ? 16 : 18)} aria-hidden />
    </button>
  )
}
