import { createStore } from "zustand/vanilla";

export enum ModalType {
	NONE = "NONE",
	WALLET = "WALLET",
	SLIPPAGE = "SLIPPAGE",
	TOKENS = "TOKENS",
	SWAP_SUCCESS = "SWAP_SUCCESS",
}

export interface IModal<T = unknown> {
	readonly openModal: ModalType;
	readonly data?: T;
}

export interface IModalActions {
	readonly actions: {
		setOpenModal: (openModal: ModalType, data?: unknown) => void;
		closeModal: () => void;
	};
}

export interface IModalStore extends IModal, IModalActions {}

export const initModalState: IModal = {
	openModal: ModalType.NONE,
};

export type ModalStore = ReturnType<typeof createModalStore>;

export const createModalStore = (initState: IModal = initModalState) => {
	return createStore<IModalStore>()((set) => ({
		...initState,
		actions: {
			setOpenModal: (openModal: ModalType, data?: unknown) =>
				set({ openModal, data }),
			closeModal: () => set(initState),
		},
	}));
};
