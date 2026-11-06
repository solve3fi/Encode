import type { IconProps } from "@tabler/icons-react";
import type { ForwardRefExoticComponent, RefAttributes } from "react";
import type { StoreApi } from "zustand/vanilla";

export type StoreSubscribeWithSelector<T> = {
	subscribe: {
		(
			listener: (selectedState: T, previousSelectedState: T) => void,
		): () => void;
		<U>(
			selector: (state: T) => U,
			listener: (selectedState: U, previousSelectedState: U) => void,
			options?: {
				equalityFn?: (a: U, b: U) => boolean;
				fireImmediately?: boolean;
			},
		): () => void;
	};
};

export type Write<T, U> = Omit<T, keyof U> & U;

export type StoreSubscribeApi<T> = Write<
	StoreApi<T>,
	StoreSubscribeWithSelector<T>
>;

export type TablerIconsProps = ForwardRefExoticComponent<
	Omit<IconProps, "ref"> & RefAttributes<SVGSVGElement>
>;
