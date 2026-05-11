Rails.application.routes.draw do
  namespace :api do
    resource :session, only: %i[create show], controller: :session

    resources :submissions, only: %i[create show index] do
      post :submit, on: :member
      post :quote, on: :member
    end

    resources :quotes, only: %i[show] do
      post :request_bind, on: :member
    end
    resources :payment_intents, path: "payment-intents", only: %i[create]

    namespace :underwriting do
      resources :referrals, only: %i[index show] do
        post :approve, on: :member
        post :decline, on: :member
      end
    end

    resources :policies, only: %i[index show] do
      resources :endorsements, only: %i[create] do
        post :issue, on: :member
      end
      get "documents", to: "documents#index"
      get "documents/:document_id", to: "documents#show", as: :document
      post "renewals", to: "renewals#create"
    end
    resources :renewals, only: %i[index] do
      post :request_bind, on: :member, action: :bind
    end
    resources :audit_events, path: "audit-events", only: %i[index]
    resources :webhook_events, path: "webhook-events", only: %i[index]

    namespace :admin do
      resources :rating_tables, path: "rating-tables", only: %i[index create]
    end

    namespace :partner do
      namespace :v1 do
        post "quotes", to: "quotes#create"
        post "bind", to: "bind#create"
        get "policies/:policy_number", to: "policies#show"
      end
    end
  end

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check

  # Defines the root path route ("/")
  # root "posts#index"
end
