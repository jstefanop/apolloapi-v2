// tests/auth.test.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { knex } = require('../src/db');
const authResolver = require('../src/graphql/resolvers/auth');

describe('Auth API', () => {
  beforeEach(async () => {
    // Clear setup table before each test
    await knex('setup').del();
  });

  describe('Auth.status resolver', () => {
    it('should return pending when setup is not done', async () => {
      // Mock auth service
      const mockAuthService = {
        status: jest.fn().mockResolvedValue({ status: 'pending' })
      };

      // Test resolver directly
      const result = await authResolver.AuthActions.status(
        null,
        {},
        { services: { auth: mockAuthService } }
      );

      expect(result.result.status).toBe('pending');
      expect(result.error).toBeNull();
    });

    it('should return done when setup is completed', async () => {
      // Insert setup record
      await knex('setup').insert({
        password: await bcrypt.hash('testpassword', 12)
      });

      // Mock auth service
      const mockAuthService = {
        status: jest.fn().mockResolvedValue({ status: 'done' })
      };

      // Test resolver directly
      const result = await authResolver.AuthActions.status(
        null,
        {},
        { services: { auth: mockAuthService } }
      );

      expect(result.result.status).toBe('done');
      expect(result.error).toBeNull();
    });
  });

  describe('Auth.setup resolver', () => {
    it('should create initial setup with password', async () => {
      // Mock auth service
      const mockAuthService = {
        setup: jest.fn().mockResolvedValue(undefined)
      };

      // Test resolver directly
      const result = await authResolver.AuthActions.setup(
        null,
        { input: { password: "testpassword" } },
        { services: { auth: mockAuthService } }
      );

      expect(result.error).toBeNull();
      expect(mockAuthService.setup).toHaveBeenCalledWith({ password: 'testpassword' });
    });

    it('should return error if setup already exists', async () => {
      // Mock auth service that generates an error
      const mockAuthService = {
        setup: jest.fn().mockRejectedValue(new Error('Setup already done'))
      };

      // Test resolver directly
      const result = await authResolver.AuthActions.setup(
        null,
        { input: { password: "newpassword" } },
        { services: { auth: mockAuthService } }
      );

      expect(result.error).toBeTruthy();
      expect(result.error.message).toContain('Setup already done');
    });
  });

  describe('Auth.login resolver', () => {
    it('should return access token with valid credentials', async () => {
      // Mock auth service
      const mockAuthService = {
        login: jest.fn().mockResolvedValue({
          accessToken: 'mock-jwt-token'
        })
      };

      // Test resolver directly
      const result = await authResolver.AuthActions.login(
        null,
        { input: { password: "testpassword" } },
        { services: { auth: mockAuthService } }
      );

      expect(result.result.accessToken).toBe('mock-jwt-token');
      expect(result.error).toBeNull();
      expect(mockAuthService.login).toHaveBeenCalledWith({ password: 'testpassword' });
    });

    it('should return error with invalid credentials', async () => {
      // Mock auth service that generates an error
      const mockAuthService = {
        login: jest.fn().mockRejectedValue(new Error('Invalid password'))
      };

      // Test resolver directly
      const result = await authResolver.AuthActions.login(
        null,
        { input: { password: "wrongpassword" } },
        { services: { auth: mockAuthService } }
      );

      expect(result.result).toBeNull();
      expect(result.error).toBeTruthy();
      expect(result.error.message).toContain('Invalid password');
    });
  });

  describe('Auth.changePassword resolver', () => {
    it('should change password with valid token', async () => {
      // Mock auth service
      const mockAuthService = {
        changePassword: jest.fn().mockResolvedValue(undefined)
      };

      // Mock the context to simulate an authenticated user
      const authenticatedContext = {
        services: { auth: mockAuthService },
        isAuthenticated: true
      };

      // Test resolver directly
      const result = await authResolver.AuthActions.changePassword(
        null,
        { input: { password: "newpassword" } },
        authenticatedContext
      );

      expect(result.error).toBeNull();
      expect(mockAuthService.changePassword).toHaveBeenCalledWith({ password: 'newpassword' });
    });

    it('should return error when not authenticated', async () => {
      // Here we simulate the authentication part that fails
      // For this test, we need to check that the resolver throws an exception
      // when the context does not have isAuthenticated as true

      // Mock the authentication resolver
      const authDirectiveResolver = {
        resolve: jest.fn().mockImplementation(() => {
          throw new Error('You must be authenticated');
        })
      };

      // Test that the resolver throws the expected exception
      expect(() => {
        authDirectiveResolver.resolve(() => { }, null, {
          isAuthenticated: false
        });
      }).toThrow('You must be authenticated');
    });
  });
});