import { CommonModule } from '@angular/common';
import { ApplicationRef, ChangeDetectorRef, EventEmitter, NgModule } from '@angular/core';
import { augment, DeepReadonly, Derivation, FutureState, listenToDevtoolsDispatch, Readable } from 'olik';
import { from, Observable } from 'rxjs';

declare module 'olik' {
  interface Readable<S> {
    observe: () => Observable<DeepReadonly<S>>;
  }
  interface Derivation<R> {
    observe: () => Observable<DeepReadonly<R>>;
  }
  interface Future<C> {
    asObservableFuture: () => Observable<FutureState<DeepReadonly<C>>>;
    asObservable: () => Observable<DeepReadonly<C>>;
  }
  interface Async<C> extends Observable<C> {
  }
}

type FunctionParameter<T> = T extends (arg: infer H) => any ? H : never;
type ClassObservables<T> = {
  [I in keyof T]: T[I] extends Observable<any> ? FunctionParameter<Parameters<T[I]['subscribe']>[0]> : never;
};
type SubType<Base, Condition> = Pick<Base, {
  [Key in keyof Base]: Base[Key] extends Condition ? Key : never
}[keyof Base]>;
type Observables<T> = ClassObservables<SubType<Omit<T, 'state'>, Observable<any>>>;

export const synchronizeObservables = <C>(component: C, changeDetector: ChangeDetectorRef) => {
  let initialized = false;
  setTimeout(() => initialized = true)
  const result = {};
  const subscriptions = (Object.keys(component) as Array<keyof C>)
    .filter(key => (component as any)[key] instanceof Observable && !((component as any)[key] instanceof EventEmitter))
    .map(key => (component[key] as any as Observable<any>).subscribe(r => {
      Object.assign(result, { [key]: r });
      if (initialized) { changeDetector.detectChanges(); }
    }));
  return Object.assign(result as DeepReadonly<Observables<C>>, { unsubscribe: () => subscriptions.forEach(s => s.unsubscribe()) });
}

@NgModule({
  imports: [CommonModule],
})
export class OlikNgModule {
  constructor(appRef: ApplicationRef) {
    listenToDevtoolsDispatch(() => appRef.tick());
    augmentCore();
  }
}

export const augmentCore = () => {
  augment({
    selection: {
      observe: <C>(selection: Readable<C>) => () => new Observable<any>(observer => {
        observer.next(selection.state);
        const subscription = selection.onChange(v => observer.next(v));
        return () => { subscription.unsubscribe(); observer.complete(); }
      }),
    },
    future: {
      asObservableFuture: (input) => () => new Observable<any>(observer => {
  
        // Call promise, and update state because there may have been an optimistic update
        // const promise = input.asPromise();
        observer.next(input.getFutureState());
  
        // Invoke then() on promise
        let running = true;
        input
          .then(() => { if (running) { observer.next(input.getFutureState()); observer.complete(); } })
          .catch(() => { if (running) { observer.next(input.getFutureState()); observer.complete(); } });
        return () => { running = false; observer.complete(); }
      }),
      asObservable: (input) => () => {
        return from(Promise.resolve(input));
      }
    },
    derivation: {
      observe: <R>(selection: Derivation<R>) => () => new Observable<any>(observer => {
        observer.next(selection.state);
        const subscription = selection.onChange(v => observer.next(v));
        return () => { subscription.unsubscribe(); observer.complete(); }
      }),
    },
    async: <C>(fnReturningFutureAugmentation: () => any) => {
      const promiseOrObservable = fnReturningFutureAugmentation();
      return promiseOrObservable.then ? promiseOrObservable : (promiseOrObservable as Observable<C>).toPromise()
    },
  })
}
